import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { Prisma } from "@openbeacon/database";

const databaseNow = new Date("2001-03-02T00:00:00.000Z");
const cutoff = "2001-01-31T00:00:00.000Z";
const cutoffHour = 272_472;
let backlog = 0;
let failures: unknown[] = [];
let epochs: Array<{ id: string; createdAt: Date }> = [];
const payloadDeletes: Array<{
  capturedCutoff: unknown;
  receivedCutoff: unknown;
  fromStream: unknown;
  limit: number;
  streamCutoff: unknown;
}> = [];
const tidyDeletes: Array<{ table: string; values: unknown[] }> = [];
const epochPages: Array<{ cutoff: unknown; after: unknown[]; limit: unknown }> = [];
const epochDeletes: string[][] = [];
let historyBacklog = { PlaceTransition: 0, GroupEvent: 0 };
const historyDeletes: Array<{ table: string; cutoff: unknown; limit: number }> = [];
let emptyStreams: string[] = [];
const windowDeletes: Array<{ values: unknown[] }> = [];
const departedDeletes: Array<{ limit: unknown }> = [];
const streamLocks: Array<{ after: unknown; limit: unknown }> = [];

const queryRaw = mock(async (query: TemplateStringsArray | Prisma.Sql, ...args: unknown[]) => {
  const [strings, values] = Array.isArray(query) ? [query, args] : [query.strings, query.values];
  if (strings.join("?").includes("clock_timestamp")) return [{ now: databaseNow }];
  if (
    strings.join("?").trimStart().startsWith('SELECT "stream".id::text AS id FROM "TrackingStream"')
  ) {
    const [after, limit] = values;
    streamLocks.push({ after, limit });
    return emptyStreams
      .filter((id) => BigInt(id) > BigInt(String(after)))
      .slice(0, Number(limit))
      .map((id) => ({ id }));
  }
  if (
    strings.join("?").trimStart().startsWith('DELETE FROM "TrackingPoint"') &&
    strings.join("?").includes('"member"."historyShare"')
  ) {
    windowDeletes.push({ values });
    return [];
  }
  if (
    strings.join("?").trimStart().startsWith('DELETE FROM "TrackingPoint"') &&
    strings.join("?").includes('NOT EXISTS (\n          SELECT 1 FROM "GroupMember"')
  ) {
    departedDeletes.push({ limit: values[0] });
    return [];
  }
  if (strings.join("?").trimStart().startsWith('DELETE FROM "TrackingPoint"')) {
    const failure = failures.shift();
    if (failure) throw failure;
    const [capturedCutoff, receivedCutoff, limit, streamCutoff, fromStream] = values;
    payloadDeletes.push({
      capturedCutoff,
      receivedCutoff,
      fromStream,
      limit: Number(limit),
      streamCutoff,
    });
    const count = Math.min(Number(limit), backlog);
    backlog -= count;
    return Array.from({ length: count }, (_, index) => ({
      streamId: String(index + 1),
    }));
  }
  const [pageCutoff, afterCreatedAt, afterId, limit] = values;
  epochPages.push({
    cutoff: pageCutoff,
    after: [afterCreatedAt, afterId],
    limit,
  });
  return epochs
    .filter(
      ({ id, createdAt }) =>
        createdAt.toISOString() > String(afterCreatedAt) ||
        (createdAt.toISOString() === afterCreatedAt && id > String(afterId)),
    )
    .slice(0, Number(limit));
});
const executeRaw = mock(async (query: TemplateStringsArray | Prisma.Sql, ...args: unknown[]) => {
  const [strings, values] = Array.isArray(query) ? [query, args] : [query.strings, query.values];
  if (strings.join("?").trimStart().startsWith('DELETE FROM "GroupEpoch"')) {
    epochDeletes.push(values[0] as string[]);
    const failure = failures.shift();
    if (failure) throw failure;
    return 0;
  }
  const historyTable = (["PlaceTransition", "GroupEvent"] as const).find((table) =>
    strings.join("?").trimStart().startsWith(`DELETE FROM "${table}"`),
  );
  if (historyTable) {
    const failure = failures.shift();
    if (failure) throw failure;
    const limit = Number(values[1]);
    historyDeletes.push({ table: historyTable, cutoff: values[0], limit });
    const count = Math.min(limit, historyBacklog[historyTable]);
    historyBacklog[historyTable] -= count;
    return count;
  }
  const tidyTable = (["TrackingLatestPoint", "TrackingStream"] as const).find((table) =>
    strings.join("?").trimStart().startsWith(`DELETE FROM "${table}"`),
  );
  if (tidyTable) {
    tidyDeletes.push({ table: tidyTable, values });
    return 0;
  }
  throw new Error(`Unexpected statement: ${strings.join("?")}`);
});

mock.module("../services.ts", () => ({
  services: {
    db: {
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
      $transaction: async (
        callback: (tx: { $queryRaw: typeof queryRaw; $executeRaw: typeof executeRaw }) => unknown,
      ) => callback({ $queryRaw: queryRaw, $executeRaw: executeRaw }),
    },
  },
}));
const { createEpochCleanup, createGroupHistoryCleanup, createLocationHistoryCleanup } =
  await import("./locationHistoryCleanup.ts");
afterAll(() => mock.restore());
beforeEach(() => {
  backlog = 0;
  failures = [];
  epochs = [];
  payloadDeletes.length = 0;
  tidyDeletes.length = 0;
  epochPages.length = 0;
  epochDeletes.length = 0;
  historyBacklog = { PlaceTransition: 0, GroupEvent: 0 };
  historyDeletes.length = 0;
  emptyStreams = [];
  streamLocks.length = 0;
  windowDeletes.length = 0;
  departedDeletes.length = 0;
});

test("deletes location points older than database time minus exactly 30 days in batches, then stale latest points and empty streams", async () => {
  backlog = 2_500;
  await createLocationHistoryCleanup()();
  expect(payloadDeletes).toEqual([
    ...["0", "1000", "1000"].map((fromStream) => ({
      capturedCutoff: cutoffHour,
      receivedCutoff: cutoffHour,
      fromStream,
      limit: 1000,
      streamCutoff: cutoff,
    })),
  ]);
  expect(backlog).toBe(0);
  expect(windowDeletes).toHaveLength(1);
  expect(windowDeletes[0]?.values).toContain(272_472 + 30 * 24 - 5);
  expect(departedDeletes).toEqual([{ limit: 1000 }]);
  expect(tidyDeletes).toEqual([
    { table: "TrackingLatestPoint", values: [cutoff] },
    { table: "TrackingLatestPoint", values: [] },
  ]);
  expect(streamLocks).toEqual([{ after: "0", limit: 1000 }]);
});

test("locks empty streams in batches and deletes only the locked ones", async () => {
  emptyStreams = ["3", "8", "12", "20", "31"];
  await createLocationHistoryCleanup({ batchSize: 2 })();
  expect(streamLocks).toEqual([
    { after: "0", limit: 2 },
    { after: "8", limit: 2 },
    { after: "20", limit: 2 },
  ]);
  expect(tidyDeletes).toEqual([
    { table: "TrackingLatestPoint", values: [cutoff] },
    { table: "TrackingLatestPoint", values: [] },
    { table: "TrackingStream", values: [["3", "8"]] },
    { table: "TrackingStream", values: [["12", "20"]] },
    { table: "TrackingStream", values: [["31"]] },
  ]);
});

test("stops at the run limit, logs it and leaves the rest for later runs", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  backlog = 10;
  const run = createLocationHistoryCleanup({ batchSize: 4, runLimit: 6 });
  await run();
  expect(payloadDeletes.map(({ limit }) => limit)).toEqual([4, 2]);
  expect(windowDeletes).toEqual([]);
  expect(departedDeletes).toEqual([]);
  expect(backlog).toBe(4);
  expect(warn.mock.calls).toEqual([
    [
      "Location history clean-up reached its limit of 6 points; the rest will be deleted on later runs",
    ],
  ]);
  warn.mockClear();
  await run();
  expect(backlog).toBe(0);
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

test("logs a failed batch with only its code and stops the run", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  backlog = 5_000;
  failures = [Object.assign(new Error("row secret"), { code: "P2010" })];
  await createLocationHistoryCleanup()();
  expect(payloadDeletes).toEqual([]);
  expect(tidyDeletes).toEqual([]);
  expect(error.mock.calls).toEqual([["Location history clean-up failed (P2010)"]]);
  error.mockRestore();
});

test("walks old epochs once in pages and only offers each page for deletion", async () => {
  epochs = ["a", "b", "c", "d", "e"].map((id, index) => ({
    id,
    createdAt: new Date(Date.UTC(2000, 0, 1 + Math.floor(index / 2))),
  }));
  await createEpochCleanup({ pageSize: 2 })();
  expect(epochDeletes).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  expect(epochPages.map(({ cutoff, limit }) => [cutoff, limit])).toEqual([
    [cutoff, 2],
    [cutoff, 2],
    [cutoff, 2],
  ]);
  expect(epochPages[1]?.after).toEqual(["2000-01-01T00:00:00.000Z", "b"]);
});

test("logs a failed epoch page with only its code and stops", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  epochs = [{ id: "a", createdAt: new Date(Date.UTC(2000, 0, 1)) }];
  failures = [Object.assign(new Error("row secret"), { code: "P2034" })];
  await createEpochCleanup()();
  expect(error.mock.calls).toEqual([["Epoch clean-up failed (P2034)"]]);
  error.mockRestore();
});

test("stops each group history table at the run limit and warns without identifiers", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  historyBacklog = { PlaceTransition: 10, GroupEvent: 3 };
  const run = createGroupHistoryCleanup({ batchSize: 4, runLimit: 6 });
  await run();
  expect(historyDeletes).toEqual([
    { table: "PlaceTransition", cutoff, limit: 4 },
    { table: "PlaceTransition", cutoff, limit: 2 },
    { table: "GroupEvent", cutoff, limit: 4 },
  ]);
  expect(historyBacklog).toEqual({ PlaceTransition: 4, GroupEvent: 0 });
  expect(warn.mock.calls).toEqual([
    [
      "Place transition clean-up reached its limit of 6 rows; the rest will be deleted on later runs",
    ],
  ]);
  warn.mockClear();
  await run();
  expect(historyBacklog).toEqual({ PlaceTransition: 0, GroupEvent: 0 });
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

test("still cleans group events when place transitions fail", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  historyBacklog = { PlaceTransition: 5, GroupEvent: 5 };
  failures = [Object.assign(new Error("row secret"), { code: "P2010" })];
  await createGroupHistoryCleanup()();
  expect(historyBacklog).toEqual({ PlaceTransition: 5, GroupEvent: 0 });
  expect(error.mock.calls).toEqual([["Place transition clean-up failed (P2010)"]]);
  error.mockRestore();
});
