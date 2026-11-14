import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { Prisma } from "@openbeacon/database";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";

const databaseNow = new Date("2001-03-02T00:00:00.000Z");
const cutoff = "2001-02-16T00:00:00.000Z";
let backlog = 0;
let failures: unknown[] = [];
let epochs: Array<{ id: string; createdAt: Date }> = [];
const payloadDeletes: Array<{ kind: unknown; cutoff: unknown; limit: number }> = [];
const epochPages: Array<{ cutoff: unknown; after: unknown[]; limit: unknown }> = [];
const epochDeletes: string[][] = [];

const queryRaw = mock(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  if (strings.join("?").includes("clock_timestamp")) return [{ now: databaseNow }];
  const [pageCutoff, afterCreatedAt, afterId, limit] = values;
  epochPages.push({ cutoff: pageCutoff, after: [afterCreatedAt, afterId], limit });
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
  const failure = failures.shift();
  if (failure) throw failure;
  const limit = Number(values[2]);
  payloadDeletes.push({ kind: values[0], cutoff: values[1], limit });
  const count = Math.min(limit, backlog);
  backlog -= count;
  return count;
});

mock.module("../services.ts", () => ({
  services: { db: { $queryRaw: queryRaw, $executeRaw: executeRaw } },
}));
const { createEpochCleanup, createLocationHistoryCleanup } =
  await import("./locationHistoryCleanup.ts");
afterAll(() => mock.restore());
beforeEach(() => {
  backlog = 0;
  failures = [];
  epochs = [];
  payloadDeletes.length = 0;
  epochPages.length = 0;
  epochDeletes.length = 0;
});

test("deletes location points older than database time minus exactly 14 days in batches", async () => {
  backlog = 2_500;
  await createLocationHistoryCleanup()();
  expect(payloadDeletes).toEqual([
    { kind: TRACKING_POINT_KIND, cutoff, limit: 1000 },
    { kind: TRACKING_POINT_KIND, cutoff, limit: 1000 },
    { kind: TRACKING_POINT_KIND, cutoff, limit: 1000 },
  ]);
  expect(backlog).toBe(0);
});

test("stops at the run limit, logs it and leaves the rest for later runs", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  backlog = 10;
  const run = createLocationHistoryCleanup({ batchSize: 4, runLimit: 6 });
  await run();
  expect(payloadDeletes.map(({ limit }) => limit)).toEqual([4, 2]);
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
