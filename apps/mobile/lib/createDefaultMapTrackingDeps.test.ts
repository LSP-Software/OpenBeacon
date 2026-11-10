import { expect, mock, test } from "bun:test";
import type { MapTrackingEncryptedPoint } from "./mapTrackingTypes.ts";
import { subscribeToGroupEpochChanges } from "./trackingEvents.ts";

let status: "ok" | "undecryptable" = "undecryptable";
mock.module("./api.ts", () => ({ trpcClient: {} }));
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
