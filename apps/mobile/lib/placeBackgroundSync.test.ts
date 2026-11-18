import { beforeEach, describe, expect, jest, mock, test } from "bun:test";

type Place = {
  emoji: string;
  geometry: { latitude: number; longitude: number; radiusMeters: number } | null;
  id: string;
  name: string;
};

const storageValues = new Map<string, string | number | boolean>();
const nativePlaces: { groupId: string; places: unknown[] }[] = [];
const notices: { kind: string; title: string; body: string | null; key: string }[] = [];
const catchUps: string[] = [];
const imageCatchUps: string[] = [];
let movedImageKeys = 0;
let imageCatchUpFails = false;
const invalidated: unknown[] = [];
let movedByCatchUp = 0;
let places: Place[] = [];
let sharingEnabled = true;
let nativeAccepts = true;
let listCalls = 0;
let failNotices = false;
let detectedGroups: string[] | null = null;
let provisionedKeys: { epochId: string; groupId: string; senderDeviceId: string }[] = [];
let imageCatchUpGate: Promise<void> | null = null;
let groupListCalls = 0;

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => {
      const value = storageValues.get(key);
      return typeof value === "string" ? value : undefined;
    },
    getNumber: (key: string) => {
      const value = storageValues.get(key);
      return typeof value === "number" ? value : undefined;
    },
    set: (key: string, value: string | number | boolean) => {
      storageValues.set(key, value);
    },
    remove: (key: string) => storageValues.delete(key),
  },
}));
mock.module("./currentServer.ts", () => ({ getBaseUrl: () => "https://api.example.test" }));
mock.module("./deviceKeys.ts", () => ({
  getRegisteredDeviceKey: async () => ({ deviceId: "device-1", userId: "user-1" }),
}));
mock.module("./placeSync.ts", () => ({
  groupPlacesQueryKey: (groupId: string) => ["groupPlaces", groupId],
  loadGroupPlaces: async () => {
    listCalls += 1;
    return places;
  },
}));
mock.module("./placeCatchUp.ts", () => ({
  catchUpGroupPlaces: async ({ groupId }: { groupId: string }) => {
    catchUps.push(groupId);
    return movedByCatchUp;
  },
}));
mock.module("./imageKeyCatchUp.ts", () => ({
  catchUpGroupImageKeys: async ({
    groupId,
    groups,
  }: {
    groupId: string;
    groups?: () => Promise<unknown>;
  }) => {
    imageCatchUps.push(groupId);
    await groups?.();
    await imageCatchUpGate;
    if (imageCatchUpFails) throw new Error("offline");
    return movedImageKeys;
  },
}));
mock.module("./personalNicknames.ts", () => ({
  loadPersonalNicknames: async () => ({ "member-sam": { name: "Mum", ciphertext: "sealed" } }),
}));
mock.module("./notifications.ts", () => ({
  showEventNotice: async (notice: {
    kind: string;
    title: string;
    body: string | null;
    key: string;
  }) => {
    if (failNotices) throw new Error("Notifications unavailable");
    notices.push({ kind: notice.kind, title: notice.title, body: notice.body, key: notice.key });
    return true;
  },
}));
mock.module("./trackingModule.ts", () => ({
  loadTrackingModule: async () => ({
    listPlaceGroups: () => detectedGroups,
    listProvisionedEpochKeys: () => provisionedKeys,
    setGroupPlaces: async (
      _owner: string,
      _deviceId: string,
      groupId: string,
      input: unknown[],
    ) => {
      nativePlaces.push({ groupId, places: input });
      return nativeAccepts;
    },
  }),
}));
mock.module("./api.ts", () => ({
  queryClient: {
    invalidateQueries: async ({ queryKey }: { queryKey: unknown }) => {
      invalidated.push(queryKey);
    },
  },
  trpc: { groupMembership: { list: { queryKey: () => [["groupMembership", "list"]] } } },
  trpcClient: {
    placeSharing: { get: { query: async () => ({ enabled: sharingEnabled, arrivalsOff: [] }) } },
    groupMembership: {
      list: {
        query: async () => {
          groupListCalls += 1;
          return [
            {
              id: "family",
              name: "Family",
              members: [
                { id: "member-sam", userId: "user-sam", name: "Sam" },
                { id: "member-alex", userId: "user-alex", name: "Alex" },
              ],
            },
          ];
        },
      },
    },
  },
}));

const {
  applyPlaceUpdates,
  describePlaceAlert,
  describePlacesChanged,
  getPlaceAlertsCursor,
  markPlacesUnsynced,
  settleImageKeyCatchUps,
  syncGroupPlaces,
} = await import("./placeBackgroundSync.ts");

const home: Place = {
  emoji: "🏠",
  geometry: { latitude: 51.5, longitude: -0.12, radiusMeters: 250 },
  id: "home",
  name: "Home",
};
const school: Place = {
  emoji: "🏫",
  geometry: { latitude: 51.52, longitude: -0.1, radiusMeters: 500 },
  id: "school",
  name: "School",
};
const syncing: Place = { emoji: "⚽", geometry: null, id: "football", name: "Football club" };

const alert = (
  overrides: Partial<{ id: string; userId: string; direction: "ARRIVE" | "LEAVE" }>,
) => ({
  id: "alert-1",
  groupId: "family",
  placeId: "home",
  placeName: "Home",
  placeEmoji: "🏠",
  direction: "ARRIVE" as const,
  occurredAt: new Date(0),
  userId: "user-sam",
  deviceId: "device-sam",
  deviceName: "Pixel 8",
  ...overrides,
});

beforeEach(() => {
  storageValues.clear();
  nativePlaces.length = 0;
  notices.length = 0;
  catchUps.length = 0;
  imageCatchUps.length = 0;
  movedImageKeys = 0;
  imageCatchUpFails = false;
  invalidated.length = 0;
  movedByCatchUp = 0;
  places = [home];
  sharingEnabled = true;
  nativeAccepts = true;
  listCalls = 0;
  failNotices = false;
  detectedGroups = null;
  provisionedKeys = [];
  imageCatchUpGate = null;
  groupListCalls = 0;
});

describe("wording", () => {
  test("alerts name the person and device the way this phone does", () => {
    expect(describePlaceAlert({ alert: alert({}), ownerName: "Sam" })).toBe(
      "Sam’s Pixel 8 arrived at 🏠 Home",
    );
    expect(describePlaceAlert({ alert: alert({ direction: "LEAVE" }), ownerName: null })).toBe(
      "Someone’s Pixel 8 left 🏠 Home",
    );
  });

  test("a place notice says what changed and that this phone will share arrivals", () => {
    expect(describePlacesChanged({ added: [school], groupName: "Family", moved: [] })).toEqual({
      title: "Family added 🏫 School",
      body: "This phone will tell Family when it arrives at or leaves School.",
    });
    expect(describePlacesChanged({ added: [], groupName: "Family", moved: [home] }).title).toBe(
      "Family moved 🏠 Home",
    );
    expect(describePlacesChanged({ added: [school], groupName: "Family", moved: [home] })).toEqual({
      title: "Family changed 2 places",
      body: "This phone will tell Family when it arrives at or leaves them.",
    });
  });
});

describe("syncGroupPlaces", () => {
  test("gives native detection only places this phone can read, and announces them", async () => {
    places = [home, syncing];
    expect(await syncGroupPlaces({ groupId: "family", quietPlaceIds: [], userId: "user-1" })).toBe(
      true,
    );
    expect(nativePlaces).toEqual([
      {
        groupId: "family",
        places: [{ placeId: "home", latitude: 51.5, longitude: -0.12, radiusMeters: 250 }],
      },
    ]);
    expect(notices).toEqual([
      {
        kind: "placesChanged",
        key: "family",
        title: "Family added 🏠 Home",
        body: "This phone will tell Family when it arrives at or leaves Home.",
      },
    ]);
  });

  test("announces only added or moved places, and a place once it finishes syncing", async () => {
    places = [home, syncing];
    await syncGroupPlaces({ groupId: "family", quietPlaceIds: [], userId: "user-1" });
    notices.length = 0;
    await syncGroupPlaces({ groupId: "family", quietPlaceIds: [], userId: "user-1" });
    expect(notices).toEqual([]);
    places = [
      { ...home, name: "Our house" },
      { ...syncing, geometry: school.geometry },
    ];
    await syncGroupPlaces({ groupId: "family", quietPlaceIds: [], userId: "user-1" });
    expect(notices.map(({ title }) => title)).toEqual(["Family added ⚽ Football club"]);
    notices.length = 0;
    places = [{ ...home, geometry: { latitude: 51.5, longitude: -0.12, radiusMeters: 300 } }];
    await syncGroupPlaces({ groupId: "family", quietPlaceIds: [], userId: "user-1" });
    expect(notices.map(({ title }) => title)).toEqual(["Family moved 🏠 Home"]);
  });

  test("with the switch off, native detection gets no places and nothing is announced", async () => {
    sharingEnabled = false;
    await syncGroupPlaces({ groupId: "family", quietPlaceIds: [], userId: "user-1" });
    expect(nativePlaces).toEqual([{ groupId: "family", places: [] }]);
    expect(notices).toEqual([]);
  });

  test("a change made on this phone updates detection without a notice", async () => {
    await syncGroupPlaces({ groupId: "family", quietPlaceIds: "all", userId: "user-1" });
    await syncGroupPlaces({ groupId: "family", quietPlaceIds: [], userId: "user-1" });
    expect(nativePlaces).toHaveLength(2);
    expect(notices).toEqual([]);
  });

  test("a place saved on this phone stays quiet, but other admins' new places are announced", async () => {
    await syncGroupPlaces({ groupId: "family", quietPlaceIds: [], userId: "user-1" });
    notices.length = 0;
    places = [home, school, { ...syncing, geometry: home.geometry }];
    await syncGroupPlaces({ groupId: "family", quietPlaceIds: ["school"], userId: "user-1" });
    expect(notices.map(({ title }) => title)).toEqual(["Family added ⚽ Football club"]);
  });

  test("turning the switch off clears native detection without asking the server", async () => {
    await syncGroupPlaces({
      groupId: "family",
      quietPlaceIds: "all",
      sharingOff: true,
      userId: "user-1",
    });
    expect(listCalls).toBe(0);
    expect(nativePlaces).toEqual([{ groupId: "family", places: [] }]);
  });

  test("doesn't remember places when native detection belongs to another account", async () => {
    nativeAccepts = false;
    expect(await syncGroupPlaces({ groupId: "family", quietPlaceIds: [], userId: "user-1" })).toBe(
      false,
    );
    nativeAccepts = true;
    await syncGroupPlaces({ groupId: "family", quietPlaceIds: [], userId: "user-1" });
    expect(notices).toHaveLength(1);
  });
});

describe("applyPlaceUpdates", () => {
  const summary = (revision: number, needsCatchUp = false) => ({
    places: [{ groupId: "family", revision, needsCatchUp }],
  });

  test("refreshes places only when the revision changes", async () => {
    await applyPlaceUpdates({ updates: summary(1), userId: "user-1" });
    await applyPlaceUpdates({ updates: summary(1), userId: "user-1" });
    expect(listCalls).toBe(1);
    await applyPlaceUpdates({ updates: summary(2), userId: "user-1" });
    expect(listCalls).toBe(2);
  });

  test("re-arms detection when the phone lost a group's places, even if the revision is unchanged", async () => {
    await applyPlaceUpdates({ updates: summary(1), userId: "user-1" });
    detectedGroups = ["family"];
    await applyPlaceUpdates({ updates: summary(1), userId: "user-1" });
    expect(listCalls).toBe(1);
    detectedGroups = [];
    await applyPlaceUpdates({ updates: summary(1), userId: "user-1" });
    expect(listCalls).toBe(2);
  });

  test("reloads a group's places after this phone couldn't apply a change to them", async () => {
    await applyPlaceUpdates({ updates: summary(1), userId: "user-1" });
    markPlacesUnsynced({ groupId: "family", userId: "user-1" });
    await applyPlaceUpdates({ updates: summary(1), userId: "user-1" });
    expect(listCalls).toBe(2);
  });

  test("tells an open app to reload a group's places when they change", async () => {
    await applyPlaceUpdates({ updates: summary(1), userId: "user-1" });
    await applyPlaceUpdates({ updates: summary(1), userId: "user-1" });
    expect(invalidated).toEqual([["groupPlaces", "family"]]);
  });

  test("tells an open app to reload a group's places after catch-up moves some", async () => {
    storageValues.set(
      `places.revision.${JSON.stringify(["https://api.example.test", "user-1", "family"])}`,
      1,
    );
    await applyPlaceUpdates({ updates: summary(1, true), userId: "user-1" });
    expect(invalidated).toEqual([]);
    jest.useFakeTimers();
    try {
      jest.setSystemTime(Date.now() + 15 * 60_000);
      movedByCatchUp = 2;
      await applyPlaceUpdates({ updates: summary(1, true), userId: "user-1" });
      expect(invalidated).toEqual([["groupPlaces", "family"]]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("runs catch-up at most once every 15 minutes per group", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-11-15T10:00:00.000Z"));
      await applyPlaceUpdates({ updates: summary(1, true), userId: "user-1" });
      jest.setSystemTime(new Date("2026-11-15T10:14:00.000Z"));
      await applyPlaceUpdates({ updates: summary(1, true), userId: "user-1" });
      expect(catchUps).toEqual(["family"]);
      jest.setSystemTime(new Date("2026-11-15T10:15:00.000Z"));
      await applyPlaceUpdates({ updates: summary(1, true), userId: "user-1" });
      expect(catchUps).toEqual(["family", "family"]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("shows each alert with this phone's nicknames, then saves the cursor", async () => {
    await applyPlaceUpdates({
      updates: {
        placeAlerts: {
          alerts: [alert({}), alert({ id: "alert-2", userId: "user-alex", direction: "LEAVE" })],
          cursor: "2026-11-15T10:00:00.000Z|alert-2",
        },
      },
      userId: "user-1",
    });
    expect(notices).toEqual([
      { kind: "alert", key: "alert-1", title: "Mum’s Pixel 8 arrived at 🏠 Home", body: null },
      { kind: "alert", key: "alert-2", title: "Alex’s Pixel 8 left 🏠 Home", body: null },
    ]);
    expect(getPlaceAlertsCursor("user-1")).toBe("2026-11-15T10:00:00.000Z|alert-2");
    expect(getPlaceAlertsCursor("user-2")).toBeNull();
  });

  test("keeps the old cursor when alerts can't be shown, so they come again", async () => {
    storageValues.clear();
    failNotices = true;
    await applyPlaceUpdates({
      updates: { placeAlerts: { alerts: [alert({})], cursor: "2026-11-15T10:00:00.000Z|a" } },
      userId: "user-1",
    });
    expect(getPlaceAlertsCursor("user-1")).toBeNull();
  });

  test("an empty page still moves the cursor", async () => {
    await applyPlaceUpdates({
      updates: { placeAlerts: { alerts: [], cursor: "2026-11-15T10:00:00.000Z|" } },
      userId: "user-1",
    });
    expect(getPlaceAlertsCursor("user-1")).toBe("2026-11-15T10:00:00.000Z|");
  });

  test("a stored cursor the server wouldn't accept is ignored, so alerts start from now", () => {
    storageValues.set(
      `places.alertsCursor.${JSON.stringify(["https://api.example.test", "user-1"])}`,
      "not a cursor",
    );
    expect(getPlaceAlertsCursor("user-1")).toBeNull();
  });
});

describe("picture key catch-up", () => {
  const applyAndSettle = async (input: Parameters<typeof applyPlaceUpdates>[0]) => {
    await applyPlaceUpdates(input);
    await settleImageKeyCatchUps();
  };

  test("runs for each listed group at most once every 15 minutes", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-11-16T10:00:00.000Z"));
      await applyAndSettle({
        updates: { imageKeysNeedCatchUp: ["family", "school"] },
        userId: "user-1",
      });
      expect(imageCatchUps).toEqual(["family", "school"]);
      jest.setSystemTime(new Date("2026-11-16T10:14:00.000Z"));
      await applyAndSettle({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-1" });
      await applyAndSettle({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-2" });
      expect(imageCatchUps).toEqual(["family", "school", "family"]);
      jest.setSystemTime(new Date("2026-11-16T10:15:00.000Z"));
      await applyAndSettle({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-1" });
      expect(imageCatchUps).toEqual(["family", "school", "family", "family"]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("treats a missing list as unknown and an empty one as nothing to do", async () => {
    await applyAndSettle({ updates: {}, userId: "user-1" });
    await applyAndSettle({ updates: { imageKeysNeedCatchUp: [] }, userId: "user-1" });
    expect(imageCatchUps).toEqual([]);
    expect([...storageValues.keys()].some((key) => key.includes("imageKeysCatchUpAt"))).toBe(false);
    await applyAndSettle({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-1" });
    expect(imageCatchUps).toEqual(["family"]);
  });

  test("reloads the group list only when keys moved", async () => {
    await applyAndSettle({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-1" });
    expect(invalidated).toEqual([]);
    movedImageKeys = 2;
    await applyAndSettle({ updates: { imageKeysNeedCatchUp: ["school"] }, userId: "user-1" });
    expect(invalidated).toEqual([[["groupMembership", "list"]]]);
  });

  test("shares one group list fetch between the listed groups", async () => {
    await applyAndSettle({
      updates: { imageKeysNeedCatchUp: ["family", "school"] },
      userId: "user-1",
    });
    expect(imageCatchUps).toEqual(["family", "school"]);
    expect(groupListCalls).toBe(1);
  });

  test("backs off a group whose catch-up moves nothing, and resets once something moves", async () => {
    jest.useFakeTimers();
    const start = new Date("2026-11-16T10:00:00.000Z").getTime();
    const runAt = async (minutes: number) => {
      jest.setSystemTime(start + minutes * 60_000);
      await applyAndSettle({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-1" });
      return imageCatchUps.length;
    };
    try {
      expect(await runAt(0)).toBe(1);
      expect(await runAt(14)).toBe(1);
      expect(await runAt(15)).toBe(2);
      expect(await runAt(15 + 59)).toBe(2);
      expect(await runAt(15 + 60)).toBe(3);
      expect(await runAt(75 + 359)).toBe(3);
      expect(await runAt(75 + 360)).toBe(4);
      expect(await runAt(435 + 1439)).toBe(4);
      expect(await runAt(435 + 1440)).toBe(5);
      expect(await runAt(1875 + 1439)).toBe(5);
      movedImageKeys = 1;
      expect(await runAt(1875 + 1440)).toBe(6);
      movedImageKeys = 0;
      expect(await runAt(3315 + 15)).toBe(7);
      expect(await runAt(3330 + 15)).toBe(8);
      imageCatchUpFails = true;
      expect(await runAt(3345 + 59)).toBe(8);
      expect(await runAt(3345 + 60)).toBe(9);
      expect(await runAt(3405 + 359)).toBe(9);
    } finally {
      jest.useRealTimers();
    }
  });

  test("starts over when this phone moves to a new key epoch for the group", async () => {
    jest.useFakeTimers();
    const start = new Date("2026-11-16T10:00:00.000Z").getTime();
    const runAt = async (minutes: number) => {
      jest.setSystemTime(start + minutes * 60_000);
      await applyAndSettle({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-1" });
      return imageCatchUps.length;
    };
    const keyFor = (epochId: string, senderDeviceId = "device-1") => ({
      epochId,
      groupId: "family",
      senderDeviceId,
    });
    try {
      provisionedKeys = [keyFor("epoch-1")];
      for (const minutes of [0, 15, 75, 435, 1875]) await runAt(minutes);
      expect(imageCatchUps).toHaveLength(5);
      expect(await runAt(1875 + 60)).toBe(5);
      provisionedKeys = [keyFor("epoch-1"), keyFor("epoch-2", "device-2")];
      expect(await runAt(1875 + 61)).toBe(5);
      provisionedKeys = [];
      expect(await runAt(1875 + 62)).toBe(5);
      provisionedKeys = [keyFor("epoch-2")];
      expect(await runAt(1875 + 63)).toBe(6);
      expect(await runAt(1938 + 14)).toBe(6);
      expect(await runAt(1938 + 15)).toBe(7);
      imageCatchUpFails = true;
      expect(await runAt(1953 + 59)).toBe(7);
      expect(await runAt(1953 + 60)).toBe(8);
    } finally {
      jest.useRealTimers();
    }
  });

  test("doesn't hold up the round, but settling waits for the catch-up to finish", async () => {
    let release = () => {};
    imageCatchUpGate = new Promise((resolve) => {
      release = resolve;
    });
    movedImageKeys = 1;
    await applyPlaceUpdates({
      updates: {
        imageKeysNeedCatchUp: ["family"],
        placeAlerts: { alerts: [alert({})], cursor: "2026-11-16T10:00:00.000Z|alert-1" },
      },
      userId: "user-1",
    });
    expect(getPlaceAlertsCursor("user-1")).toBe("2026-11-16T10:00:00.000Z|alert-1");
    expect(imageCatchUps).toEqual(["family"]);
    let settled = false;
    const settling = settleImageKeyCatchUps().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(invalidated).toEqual([]);
    release();
    await settling;
    expect(invalidated).toEqual([[["groupMembership", "list"]]]);
  });

  test("a round that starts while a catch-up runs skips that group and keeps its back-off", async () => {
    let release = () => {};
    imageCatchUpGate = new Promise((resolve) => {
      release = resolve;
    });
    imageCatchUpFails = true;
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-11-16T10:00:00.000Z"));
      await applyPlaceUpdates({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-1" });
      await applyPlaceUpdates({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-1" });
      release();
      await settleImageKeyCatchUps();
      expect(imageCatchUps).toEqual(["family"]);
      jest.setSystemTime(new Date("2026-11-16T10:15:00.000Z"));
      await applyAndSettle({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-1" });
      jest.setSystemTime(new Date("2026-11-16T10:30:00.000Z"));
      await applyAndSettle({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-1" });
      expect(imageCatchUps).toEqual(["family", "family"]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("forgets a group's back-off once it's no longer listed, but not when the list is missing", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-11-16T10:00:00.000Z"));
      await applyAndSettle({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-1" });
      jest.setSystemTime(new Date("2026-11-16T10:15:00.000Z"));
      await applyAndSettle({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-1" });
      jest.setSystemTime(new Date("2026-11-16T10:30:00.000Z"));
      await applyAndSettle({ updates: {}, userId: "user-1" });
      await applyAndSettle({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-1" });
      expect(imageCatchUps).toHaveLength(2);
      jest.setSystemTime(new Date("2026-11-16T10:45:00.000Z"));
      await applyAndSettle({ updates: { imageKeysNeedCatchUp: [] }, userId: "user-1" });
      await applyAndSettle({ updates: { imageKeysNeedCatchUp: ["family"] }, userId: "user-1" });
      expect(imageCatchUps).toHaveLength(3);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a failed catch-up still shows alerts and saves the cursor", async () => {
    imageCatchUpFails = true;
    await applyAndSettle({
      updates: {
        imageKeysNeedCatchUp: ["family"],
        placeAlerts: { alerts: [alert({})], cursor: "2026-11-16T10:00:00.000Z|alert-1" },
      },
      userId: "user-1",
    });
    expect(notices.map(({ key }) => key)).toEqual(["alert-1"]);
    expect(getPlaceAlertsCursor("user-1")).toBe("2026-11-16T10:00:00.000Z|alert-1");
    expect(imageCatchUps).toEqual(["family"]);
  });
});
