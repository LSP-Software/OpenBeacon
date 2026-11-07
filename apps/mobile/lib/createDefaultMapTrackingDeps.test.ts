import { expect, mock, test } from "bun:test";
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
  const input = {
    groupId: "group",
    point: { epochId: "epoch" } as Parameters<typeof deps.decryptPoint>[0]["point"],
  };

  await deps.decryptPoint(input);
  expect(changes).toEqual([]);
  status = "ok";
  await deps.decryptPoint(input);
  await deps.decryptPoint(input);
  expect(changes).toEqual(["group"]);
  unsubscribe();
});
