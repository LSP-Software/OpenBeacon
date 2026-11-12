import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";

const databaseNow = new Date("2001-01-01T00:00:00.000Z");
const getDatabaseTime = mock(async () => [{ now: databaseNow }]);
const deleteVerifications = mock(async (_args: unknown) => ({ count: 2 }));
const deleteBatch = mock(async (..._args: unknown[]) => 0);

mock.module("../services.ts", () => ({
  services: {
    db: {
      $queryRaw: getDatabaseTime,
      $executeRaw: deleteBatch,
      verification: { deleteMany: deleteVerifications },
    },
  },
}));
const { runExpiredRecordsCleanup } = await import("./expiredRecordsCleanup.ts");
afterAll(() => mock.restore());
beforeEach(() => {
  getDatabaseTime.mockClear();
  deleteVerifications.mockClear();
  deleteBatch.mockReset();
  deleteBatch.mockResolvedValue(0);
});

test("deletes only rows that expired before the database time, not the runner's clock", async () => {
  await runExpiredRecordsCleanup();
  expect(deleteVerifications.mock.calls).toEqual([[{ where: { expiresAt: { lt: databaseNow } } }]]);
  expect(deleteBatch.mock.calls.map((call) => call.slice(1))).toEqual([
    [databaseNow.toISOString()],
    [databaseNow.toISOString()],
    ["2000-12-31T00:00:00.000Z"],
    ["2000-12-02T00:00:00.000Z"],
    ["2000-12-02T00:00:00.000Z"],
    ["2000-12-02T00:00:00.000Z"],
  ]);
});

test("keeps deleting full batches up to ten per table", async () => {
  deleteBatch.mockResolvedValue(1000);
  await runExpiredRecordsCleanup();
  expect(deleteBatch).toHaveBeenCalledTimes(60);
});

test("a failing table doesn't stop later tables and is logged without the error", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  deleteVerifications.mockRejectedValueOnce(new Error("verification secret"));
  deleteBatch.mockRejectedValueOnce(
    Object.assign(new Error("session secret"), { code: "P2034", meta: { secret: "secret" } }),
  );
  await runExpiredRecordsCleanup();
  expect(deleteBatch).toHaveBeenCalledTimes(6);
  expect(error.mock.calls).toEqual([
    ["Expired records clean-up failed for Verification"],
    ["Expired records clean-up failed for Session (P2034)"],
  ]);
  error.mockRestore();
});

test("deletes nothing when database time is unavailable", async () => {
  getDatabaseTime.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(runExpiredRecordsCleanup()).rejects.toThrow("database unavailable");
  expect(deleteVerifications).not.toHaveBeenCalled();
  expect(deleteBatch).not.toHaveBeenCalled();
});
