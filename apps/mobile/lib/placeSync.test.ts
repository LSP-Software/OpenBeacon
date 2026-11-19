import { beforeEach, expect, mock, test } from "bun:test";
import {
  type EpochKeyMaterial,
  generateGroupEpochKey,
  type PlaceGeometryV1,
} from "@openbeacon/encryption";
import { decryptPlaceGeometry, encryptPlaceGeometry } from "./places.ts";

const home: PlaceGeometryV1 = { v: 1, latitude: 51.5, longitude: -0.12, radiusMeters: 250 };
const epochKeys = new Map<string, EpochKeyMaterial>([
  ["epoch-1", generateGroupEpochKey()],
  ["epoch-2", generateGroupEpochKey()],
]);
let latestEpochIds: string[] = [];
let failures: unknown[] = [];
let keyLookupError: Error | null = null;
type SentPlace = {
  expectedCiphertext?: string;
  geometry: ReturnType<typeof encryptPlaceGeometry>;
  name: string;
};
const sent: { epochId: string; input: SentPlace }[] = [];
const rotate = mock(async (_groupId: string) => true);
const listedPlace = ({
  epochId,
  epochKey,
  id,
  name,
}: {
  epochId: string;
  epochKey: EpochKeyMaterial;
  id: string;
  name: string;
}) => ({
  ...encryptPlaceGeometry({
    epochId,
    epochKey,
    geometry: home,
    groupId: "family",
    senderDeviceId: "device-a",
  }),
  createdAt: new Date(0),
  emoji: "🏠",
  id,
  name,
});
const defaultPlaces = [
  listedPlace({
    epochId: "epoch-1",
    epochKey: epochKeys.get("epoch-1")!,
    id: "readable",
    name: "Home",
  }),
  listedPlace({
    epochId: "epoch-old",
    epochKey: generateGroupEpochKey(),
    id: "syncing",
    name: "Home",
  }),
];
let listedPlaces = defaultPlaces;

const reasonError = (reason: string) => Object.assign(new Error(reason), { data: { reason } });

const write = async (input: SentPlace) => {
  sent.push({ epochId: input.geometry.epochId, input });
  const failure = failures.shift();
  if (failure) throw failure;
  return { place: { id: "place-1" }, placesRevision: 1 };
};

mock.module("./api.ts", () => ({
  trpcClient: {
    groupEpoch: {
      getLatest: {
        query: async () => {
          const epochId = latestEpochIds.shift();
          return epochId ? { epochId } : null;
        },
      },
    },
    groupPlaces: {
      create: { mutate: write },
      update: { mutate: write },
      list: {
        query: async () => ({ latestEpochId: "epoch-2", placesRevision: 3, places: listedPlaces }),
      },
    },
  },
}));
mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => ({ deviceId: "device-a", userId: "user-a" }),
}));
mock.module("./epochKeys.ts", () => ({
  resolveEpochKey: async ({ epochId }: { epochId: string }) => {
    if (keyLookupError) throw keyLookupError;
    return epochKeys.get(epochId) ?? null;
  },
}));
mock.module("./groupEncryption.ts", () => ({ rotateGroupEpochIfRequired: rotate }));

const { loadGroupPlaces, savePlace } = await import("./placeSync.ts");

const saveHome = () =>
  savePlace({ emoji: "🏠", existing: null, geometry: home, groupId: "family", name: "Home" });

beforeEach(() => {
  latestEpochIds = ["epoch-1", "epoch-2"];
  failures = [];
  keyLookupError = null;
  sent.length = 0;
  listedPlaces = defaultPlaces;
  rotate.mockClear();
});

test("encrypts the geometry under the latest epoch from this device", async () => {
  await saveHome();
  const [request] = sent;
  expect(request?.epochId).toBe("epoch-1");
  expect(request?.input.name).toBe("Home");
  const geometry = request?.input.geometry;
  expect(geometry?.senderDeviceId).toBe("device-a");
  expect(
    decryptPlaceGeometry({
      epochKey: epochKeys.get("epoch-1")!,
      groupId: "family",
      place: { ...geometry!, createdAt: new Date(0) },
    }),
  ).toEqual(home);
});

test("runs a pending key rotation and retries once", async () => {
  failures = [reasonError("EPOCH_ROTATION_PENDING")];
  await saveHome();
  expect(rotate).toHaveBeenCalledWith("family");
  expect(sent.map(({ epochId }) => epochId)).toEqual(["epoch-1", "epoch-2"]);
});

test("refreshes the latest epoch and retries once when the epoch moved on", async () => {
  failures = [reasonError("EPOCH_NOT_LATEST")];
  await saveHome();
  expect(rotate).not.toHaveBeenCalled();
  expect(sent.map(({ epochId }) => epochId)).toEqual(["epoch-1", "epoch-2"]);
});

test("does not retry a second time or other errors", async () => {
  failures = [reasonError("EPOCH_NOT_LATEST"), reasonError("EPOCH_NOT_LATEST")];
  await expect(saveHome()).rejects.toThrow("EPOCH_NOT_LATEST");
  expect(sent).toHaveLength(2);

  sent.length = 0;
  latestEpochIds = ["epoch-1"];
  failures = [reasonError("PLACE_CHANGED")];
  await expect(saveHome()).rejects.toThrow("PLACE_CHANGED");
  expect(sent).toHaveLength(1);
});

test("loads places and leaves the ones this phone can't read yet as syncing", async () => {
  const places = await loadGroupPlaces("family");
  expect(places.map(({ id, geometry }) => ({ id, geometry }))).toEqual([
    { id: "readable", geometry: home },
    { id: "syncing", geometry: null },
  ]);
});

test("fails the load when the group's keys can't be fetched instead of showing syncing", async () => {
  keyLookupError = new Error("Network request failed");
  await expect(loadGroupPlaces("family")).rejects.toThrow("Network request failed");
});

const renameHome = () =>
  savePlace({
    emoji: "🏠",
    existing: {
      before: { emoji: "🏠", geometry: home, name: "Home" },
      expectedCiphertext: "before-rotation",
      placeId: "readable",
    },
    geometry: home,
    groupId: "family",
    name: "Our home",
  });

test("saves the edit again when a key rotation re-encrypted the place without changing it", async () => {
  failures = [reasonError("PLACE_CHANGED")];
  const reEncrypted = listedPlace({
    epochId: "epoch-2",
    epochKey: epochKeys.get("epoch-2")!,
    id: "readable",
    name: "Home",
  });
  listedPlaces = [reEncrypted];
  await renameHome();
  expect(sent.map(({ input }) => input.expectedCiphertext)).toEqual([
    "before-rotation",
    reEncrypted.ciphertext,
  ]);
  expect(sent[1]?.input.name).toBe("Our home");
});

test("keeps the conflict when someone else really changed the place", async () => {
  failures = [reasonError("PLACE_CHANGED")];
  listedPlaces = [
    listedPlace({
      epochId: "epoch-1",
      epochKey: epochKeys.get("epoch-1")!,
      id: "readable",
      name: "Gran's",
    }),
  ];
  await expect(renameHome()).rejects.toThrow("PLACE_CHANGED");
  expect(sent).toHaveLength(1);
});

test("keeps the conflict when the re-encrypted place can't be read yet", async () => {
  failures = [reasonError("PLACE_CHANGED")];
  listedPlaces = [
    listedPlace({
      epochId: "epoch-old",
      epochKey: generateGroupEpochKey(),
      id: "readable",
      name: "Home",
    }),
  ];
  await expect(renameHome()).rejects.toThrow("PLACE_CHANGED");
  expect(sent).toHaveLength(1);
});
