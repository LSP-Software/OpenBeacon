import { beforeEach, expect, mock, test } from "bun:test";
import {
  type EpochKeyMaterial,
  generateGroupEpochKey,
  type PlaceGeometryV1,
} from "@openbeacon/encryption";
import { decryptPlaceGeometry, encryptPlaceGeometry } from "./places.ts";

const home: PlaceGeometryV1 = { v: 1, latitude: 51.5, longitude: -0.12, radiusMeters: 250 };
const school: PlaceGeometryV1 = { v: 1, latitude: 51.52, longitude: -0.1, radiusMeters: 500 };
const moved: PlaceGeometryV1 = { v: 1, latitude: 52, longitude: -1, radiusMeters: 100 };
const keys = new Map<string, EpochKeyMaterial>();

type StoredPlace = ReturnType<typeof encryptPlaceGeometry> & {
  createdAt: Date;
  emoji: string;
  id: string;
  name: string;
};
type ReEncryptInput = {
  groupId: string;
  places: {
    emoji: string;
    expectedCiphertext: string;
    geometry: ReturnType<typeof encryptPlaceGeometry>;
    name: string;
    placeId: string;
  }[];
};

let stored: StoredPlace[] = [];
let latestEpochId: string | null = "epoch-2";
let failures: unknown[] = [];
let beforeReEncrypt: (() => void) | null = null;
let listCalls = 0;
const reEncryptCalls: ReEncryptInput[] = [];
const rotate = mock(async (_groupId: string) => true);

const once = (change: () => void) => {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    change();
  };
};

const reasonError = (reason: string) => Object.assign(new Error(reason), { data: { reason } });

const seal = ({
  epochId,
  geometry,
  senderDeviceId = "device-admin",
}: {
  epochId: string;
  geometry: PlaceGeometryV1;
  senderDeviceId?: string;
}) =>
  encryptPlaceGeometry({
    epochId,
    epochKey: keys.get(epochId)!,
    geometry,
    groupId: "family",
    senderDeviceId,
  });

const place = (id: string, epochId: string, geometry: PlaceGeometryV1): StoredPlace => ({
  ...seal({ epochId, geometry }),
  createdAt: new Date(0),
  emoji: "🏠",
  id,
  name: id,
});

const reEncrypt = async (input: ReEncryptInput) => {
  reEncryptCalls.push(structuredClone(input));
  beforeReEncrypt?.();
  const failure = failures.shift();
  if (failure) throw failure;
  const result = {
    places: [] as StoredPlace[],
    skipped: [] as string[],
    changed: [] as string[],
    gone: [] as string[],
  };
  for (const request of input.places) {
    const index = stored.findIndex(({ id }) => id === request.placeId);
    const current = stored[index];
    if (!current) result.gone.push(request.placeId);
    else if (current.epochId === request.geometry.epochId) result.skipped.push(request.placeId);
    else if (
      current.ciphertext !== request.expectedCiphertext ||
      current.name !== request.name ||
      current.emoji !== request.emoji
    ) {
      result.changed.push(request.placeId);
    } else {
      stored[index] = { ...current, ...request.geometry };
      result.places.push(stored[index]!);
    }
  }
  return { ...result, placesRevision: 1 };
};

mock.module("./api.ts", () => ({
  trpcClient: {
    groupPlaces: {
      list: {
        query: async () => {
          listCalls += 1;
          return { latestEpochId, placesRevision: 1, places: structuredClone(stored) };
        },
      },
      reEncrypt: { mutate: reEncrypt },
    },
  },
}));
mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => ({ deviceId: "device-a", userId: "user-a" }),
}));
mock.module("./epochKeys.ts", () => ({
  resolveEpochKey: async ({ epochId }: { epochId: string }) =>
    epochId === "epoch-before-joining" ? null : (keys.get(epochId) ?? null),
}));
mock.module("./groupEncryption.ts", () => ({ rotateGroupEpochIfRequired: rotate }));

const { catchUpGroupPlaces } = await import("./placeCatchUp.ts");

const family = { groupId: "family", userId: "user-a" };

const open = (target: StoredPlace, epochId: string) =>
  decryptPlaceGeometry({ epochKey: keys.get(epochId)!, groupId: "family", place: target });

beforeEach(() => {
  keys.clear();
  for (const epochId of ["epoch-1", "epoch-2", "epoch-3", "epoch-before-joining"]) {
    keys.set(epochId, generateGroupEpochKey());
  }
  latestEpochId = "epoch-2";
  stored = [
    place("home", "epoch-1", home),
    place("school", "epoch-1", school),
    place("current", "epoch-2", home),
    place("unreadable", "epoch-before-joining", home),
  ];
  failures = [];
  beforeReEncrypt = null;
  listCalls = 0;
  reEncryptCalls.length = 0;
  rotate.mockClear();
});

test("moves the places this phone can read onto the latest epoch", async () => {
  const before = structuredClone(stored);
  expect(await catchUpGroupPlaces(family)).toBe(2);

  const [home2, school2, current, unreadable] = stored;
  expect(home2?.epochId).toBe("epoch-2");
  expect(school2?.epochId).toBe("epoch-2");
  expect(home2?.senderDeviceId).toBe("device-a");
  expect(open(home2!, "epoch-2")).toEqual(home);
  expect(open(school2!, "epoch-2")).toEqual(school);
  expect(current).toEqual(before[2]!);
  expect(unreadable).toEqual(before[3]!);
  expect(reEncryptCalls).toHaveLength(1);
});

test("re-encrypts exactly the decrypted geometry, name and emoji against the stored ciphertext", async () => {
  const before = structuredClone(stored);
  await catchUpGroupPlaces(family);

  const sent = reEncryptCalls[0]!.places;
  expect(sent.map(({ placeId }) => placeId)).toEqual(["home", "school"]);
  for (const request of sent) {
    const original = before.find(({ id }) => id === request.placeId)!;
    expect(request.name).toBe(original.name);
    expect(request.emoji).toBe(original.emoji);
    expect(request.expectedCiphertext).toBe(original.ciphertext);
    expect(request.geometry.epochId).toBe("epoch-2");
    expect(
      decryptPlaceGeometry({
        epochKey: keys.get("epoch-2")!,
        groupId: "family",
        place: { ...request.geometry, createdAt: new Date(0) },
      }),
    ).toEqual(open(original, "epoch-1")!);
  }
});

test("old epoch keys can't open the places once catch-up has run", async () => {
  expect(open(stored[0]!, "epoch-1")).toEqual(home);
  await catchUpGroupPlaces(family);
  expect(open(stored[0]!, "epoch-1")).toBeNull();
  expect(open(stored[1]!, "epoch-1")).toBeNull();
});

test("does nothing when every place is up to date or unreadable", async () => {
  stored = stored.slice(2);
  expect(await catchUpGroupPlaces(family)).toBe(0);
  expect(reEncryptCalls).toHaveLength(0);

  stored = [];
  latestEpochId = null;
  expect(await catchUpGroupPlaces(family)).toBe(0);
  expect(reEncryptCalls).toHaveLength(0);
});

test("never overwrites an admin's edit made while catching up", async () => {
  beforeReEncrypt = () => {
    stored[0] = { ...stored[0]!, ...seal({ epochId: "epoch-2", geometry: moved }), name: "Home" };
  };
  expect(await catchUpGroupPlaces(family)).toBe(1);

  expect(stored[0]?.name).toBe("Home");
  expect(open(stored[0]!, "epoch-2")).toEqual(moved);
  expect(stored[0]?.senderDeviceId).toBe("device-admin");
  expect(open(stored[1]!, "epoch-2")).toEqual(school);
  expect(reEncryptCalls).toHaveLength(1);
});

test("reloads and retries once when a place changed, then stops", async () => {
  beforeReEncrypt = once(() => {
    stored[0] = { ...stored[0]!, name: "Renamed" };
  });
  expect(await catchUpGroupPlaces(family)).toBe(2);
  expect(reEncryptCalls.map(({ places }) => places.map(({ placeId }) => placeId))).toEqual([
    ["home", "school"],
    ["home"],
  ]);
  expect(stored[0]?.name).toBe("Renamed");
  expect(open(stored[0]!, "epoch-2")).toEqual(home);

  reEncryptCalls.length = 0;
  stored[1] = place("school", "epoch-1", school);
  beforeReEncrypt = () => {
    stored[1] = { ...stored[1]!, name: `${stored[1]!.name}!` };
  };
  expect(await catchUpGroupPlaces(family)).toBe(0);
  expect(reEncryptCalls).toHaveLength(2);
  expect(stored[1]?.epochId).toBe("epoch-1");
});

test("leaves a place another phone already moved without retrying", async () => {
  beforeReEncrypt = () => {
    stored[0] = { ...stored[0]!, ...seal({ epochId: "epoch-2", geometry: home }) };
  };
  expect(await catchUpGroupPlaces(family)).toBe(1);
  expect(reEncryptCalls).toHaveLength(1);
  expect(listCalls).toBe(1);
});

test("runs a pending key rotation, then retries once on the new epoch", async () => {
  failures = [reasonError("EPOCH_ROTATION_PENDING")];
  rotate.mockImplementationOnce(async () => {
    latestEpochId = "epoch-3";
    return true;
  });
  expect(await catchUpGroupPlaces(family)).toBe(3);
  expect(rotate).toHaveBeenCalledWith("family");
  expect(reEncryptCalls.map(({ places }) => places.map(({ placeId }) => placeId))).toEqual([
    ["home", "school"],
    ["home", "school", "current"],
  ]);
  expect(stored.slice(0, 3).map((item) => open(item, "epoch-3"))).toEqual([home, school, home]);
});

test("refreshes the latest epoch once, and gives up on a second failure or other errors", async () => {
  failures = [reasonError("EPOCH_NOT_LATEST")];
  expect(await catchUpGroupPlaces(family)).toBe(2);
  expect(rotate).not.toHaveBeenCalled();
  expect(reEncryptCalls).toHaveLength(2);

  stored[0] = place("home", "epoch-1", home);
  reEncryptCalls.length = 0;
  failures = [reasonError("EPOCH_NOT_LATEST"), reasonError("EPOCH_NOT_LATEST")];
  await expect(catchUpGroupPlaces(family)).rejects.toThrow("EPOCH_NOT_LATEST");
  expect(reEncryptCalls).toHaveLength(2);

  reEncryptCalls.length = 0;
  failures = [reasonError("NOT_GROUP_MEMBER")];
  await expect(catchUpGroupPlaces(family)).rejects.toThrow("NOT_GROUP_MEMBER");
  expect(reEncryptCalls).toHaveLength(1);
});

test("shares one run between callers for the same group", async () => {
  const [first, second] = await Promise.all([
    catchUpGroupPlaces(family),
    catchUpGroupPlaces(family),
  ]);
  expect([first, second]).toEqual([2, 2]);
  expect(reEncryptCalls).toHaveLength(1);
});

test("never shares a run between different people for the same group", async () => {
  const [first, second] = await Promise.all([
    catchUpGroupPlaces(family),
    catchUpGroupPlaces({ groupId: "family", userId: "user-b" }),
  ]);
  expect(first + second).toBe(2);
  expect(listCalls).toBe(2);
  expect(reEncryptCalls).toHaveLength(2);
});
