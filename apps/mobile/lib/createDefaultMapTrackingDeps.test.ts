import { expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { MapTrackingEncryptedPoint } from "./mapTrackingTypes.ts";
import { subscribeToGroupEpochChanges } from "./trackingEvents.ts";

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
const { getMembershipSignature, isTrackingKeyCheckDue, recordTrackingKeyCheck } =
  await import("./trackingKeyCheck.ts");

test("a membership change in the fetched group list makes the tracking key check due", async () => {
  const deps = createDefaultMapTrackingDeps();
  recordTrackingKeyCheck({ membership: getMembershipSignature(groups), scope: "scope" });

  await deps.listGroups(new AbortController().signal);
  expect(isTrackingKeyCheckDue("scope")).toBe(false);

  recordTrackingKeyCheck({ membership: getMembershipSignature([]), scope: "scope" });
  await deps.listGroups(new AbortController().signal);
  expect(isTrackingKeyCheckDue("scope")).toBe(true);
});

test("a group moving to a new epoch makes the tracking key check due, the first epoch seen doesn't", async () => {
  status = "ok";
  const deps = createDefaultMapTrackingDeps();
  recordTrackingKeyCheck({ membership: getMembershipSignature(groups), scope: "scope" });

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

const point = (epochId: string, id: string, createdAt: string): MapTrackingEncryptedPoint => ({
  algorithm: "xchacha20poly1305",
  ciphertext: "ciphertext",
  clientPointId: id,
  createdAt: new Date(createdAt),
  epochId,
  id,
  kind: "location",
  nonce: "nonce",
  senderDeviceId: "device",
  senderUserId: "user",
});
