import { expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { MapTrackingEncryptedPoint } from "./mapTrackingTypes.ts";
import { subscribeToGroupEpochChanges, subscribeToTrackingSync } from "./trackingEvents.ts";

let status: "ok" | "undecryptable" = "undecryptable";
const queryClient = new QueryClient();
const groupListKey = [["groupMembership", "list"], { type: "query" }];
const groups = [{ id: "group", image: null, members: [], name: "Climbing club" }];
const storageValues = new Map<string, string>();
mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    remove: (key: string) => storageValues.delete(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));
mock.module("./api.ts", () => ({
  queryClient,
  trpc: { groupMembership: { list: { queryKey: () => groupListKey } } },
  trpcClient: { groupMembership: { list: { query: async () => groups } } },
}));
mock.module("./epochKeys.ts", () => ({
  createHistoryKeyReader: () => async () => null,
  resolveEpochKey: async () => null,
  unwrapEpochKeyFromWraps: async () => null,
}));
mock.module("./mapTrackingDecrypt.ts", () => ({
  createMapTrackingDecryptPoint: () =>
    Object.assign(async () => ({ status }), { clear: () => {}, clearGroup: () => {} }),
}));

const { createDefaultMapTrackingDeps }: typeof import("./createDefaultMapTrackingDeps.ts") =
  await import("./createDefaultMapTrackingDeps.ts");
const {
  clearTrackingKeyCheck,
  getMembershipSignature,
  getTrackingKeyCheckGeneration,
  isTrackingKeyCheckDue,
  recordTrackingKeyCheck,
} = await import("./trackingKeyCheck.ts");

test("a membership change in the fetched group list makes the tracking key check due", async () => {
  const deps = createDefaultMapTrackingDeps();
  recordTrackingKeyCheck({
    generation: getTrackingKeyCheckGeneration(),
    membership: getMembershipSignature(groups),
    scope: "scope",
  });

  await deps.listGroups(new AbortController().signal);
  expect(isTrackingKeyCheckDue("scope")).toBe(false);

  recordTrackingKeyCheck({
    generation: getTrackingKeyCheckGeneration(),
    membership: getMembershipSignature([]),
    scope: "scope",
  });
  await deps.listGroups(new AbortController().signal);
  expect(isTrackingKeyCheckDue("scope")).toBe(true);
});

test("a membership change asks for one tracking sync with group notices, not one per poll", async () => {
  clearTrackingKeyCheck();
  const deps = createDefaultMapTrackingDeps();
  const syncs: Array<{ groupNotices: boolean }> = [];
  const unsubscribe = subscribeToTrackingSync((options) => syncs.push(options));

  await deps.listGroups(new AbortController().signal);
  expect(syncs).toEqual([]);

  recordTrackingKeyCheck({
    generation: getTrackingKeyCheckGeneration(),
    membership: getMembershipSignature([]),
    scope: "scope",
  });
  await deps.listGroups(new AbortController().signal);
  await deps.listGroups(new AbortController().signal);
  expect(syncs).toEqual([{ groupNotices: true }]);

  recordTrackingKeyCheck({
    generation: getTrackingKeyCheckGeneration(),
    membership: getMembershipSignature(groups),
    scope: "scope",
  });
  await deps.listGroups(new AbortController().signal);
  expect(syncs).toEqual([{ groupNotices: true }]);
  unsubscribe();
});

test("a group moving to a new epoch asks for a tracking sync", async () => {
  status = "ok";
  const deps = createDefaultMapTrackingDeps();
  const syncs: Array<{ groupNotices: boolean }> = [];
  const unsubscribe = subscribeToTrackingSync((options) => syncs.push(options));

  await deps.decryptPoint({
    groupId: "group",
    point: point("epoch-1", "point-1", "2026-07-17T10:00:00.000Z"),
  });
  expect(syncs).toEqual([]);

  await deps.decryptPoint({
    groupId: "group",
    point: point("epoch-2", "point-2", "2026-07-17T11:00:00.000Z"),
  });
  expect(syncs).toEqual([{ groupNotices: false }]);
  unsubscribe();
  status = "undecryptable";
});

test("a group moving to a new epoch makes the tracking key check due, the first epoch seen doesn't", async () => {
  status = "ok";
  const deps = createDefaultMapTrackingDeps();
  recordTrackingKeyCheck({
    generation: getTrackingKeyCheckGeneration(),
    membership: getMembershipSignature(groups),
    scope: "scope",
  });

  await deps.decryptPoint({
    groupId: "group",
    point: point("epoch-1", "point-1", "2026-07-17T10:00:00.000Z"),
  });
  expect(isTrackingKeyCheckDue("scope")).toBe(false);

  await deps.decryptPoint({
    groupId: "group",
    point: point("epoch-2", "point-2", "2026-07-17T11:00:00.000Z"),
  });
  expect(isTrackingKeyCheckDue("scope")).toBe(true);
  status = "undecryptable";
});

test("shares the group list it fetches with the screens", async () => {
  const deps = createDefaultMapTrackingDeps();

  expect(await deps.listGroups(new AbortController().signal)).toEqual(groups);
  expect(queryClient.getQueryData<typeof groups>(groupListKey)).toEqual(groups);
});

test("a newly decryptable epoch refreshes group key access once", async () => {
  const deps = createDefaultMapTrackingDeps();
  const changes: string[] = [];
  const unsubscribe = subscribeToGroupEpochChanges((groupId) => changes.push(groupId));
  const input = { groupId: "group", point: point("epoch", "point", "2026-07-17T10:00:00.000Z") };

  await deps.decryptPoint(input);
  expect(changes).toEqual([]);
  status = "ok";
  await deps.decryptPoint(input);
  await deps.decryptPoint(input);
  expect(changes).toEqual(["group"]);
  unsubscribe();
});

test("decrypting an older epoch after a newer one does not refresh group key access", async () => {
  status = "ok";
  const deps = createDefaultMapTrackingDeps();
  const changes: string[] = [];
  const unsubscribe = subscribeToGroupEpochChanges((groupId) => changes.push(groupId));
  const decrypt = (epochId: string, id: string, createdAt: string) =>
    deps.decryptPoint({ groupId: "group", point: point(epochId, id, createdAt) });

  await decrypt("epoch-2", "point-2", "2026-07-17T11:00:00.000Z");
  await decrypt("epoch-1", "point-1", "2026-07-17T10:00:00.000Z");
  await decrypt("epoch-2", "point-3", "2026-07-17T12:00:00.000Z");
  expect(changes).toEqual(["group"]);

  await decrypt("epoch-3", "point-4", "2026-07-17T13:00:00.000Z");
  expect(changes).toEqual(["group", "group"]);

  deps.clearEpochKeys("group");
  await decrypt("epoch-1", "point-1", "2026-07-17T10:00:00.000Z");
  expect(changes).toEqual(["group", "group", "group"]);
  unsubscribe();
});

const point = (
  epochId: string,
  senderDeviceId: string,
  updatedAt: string,
): MapTrackingEncryptedPoint => ({
  ciphertext: "ciphertext",
  epochId,
  nonce: "nonce",
  revisionPrefix: "",
  senderDeviceId,
  senderUserId: "user",
  updatedAt: new Date(updatedAt),
});
