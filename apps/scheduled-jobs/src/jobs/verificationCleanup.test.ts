import { afterAll, beforeEach, expect, mock, test } from "bun:test";

const databaseNow = new Date("2001-01-01T00:00:00.000Z");
const getDatabaseTime = mock(async () => [{ now: databaseNow }]);
const deleteVerifications = mock(async (_args: unknown) => ({ count: 2 }));

mock.module("../services.ts", () => ({
  services: {
    db: { $queryRaw: getDatabaseTime, verification: { deleteMany: deleteVerifications } },
  },
}));
const { runVerificationCleanup } = await import("./verificationCleanup.ts");
afterAll(() => mock.restore());
beforeEach(() => {
  getDatabaseTime.mockClear();
  deleteVerifications.mockClear();
});

test("deletes only rows that expired before the database time, not the runner's clock", async () => {
  await runVerificationCleanup();
  expect(deleteVerifications.mock.calls).toEqual([[{ where: { expiresAt: { lt: databaseNow } } }]]);
});

test("deletes nothing when database time is unavailable", async () => {
  getDatabaseTime.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(runVerificationCleanup()).rejects.toThrow("database unavailable");
  expect(deleteVerifications).not.toHaveBeenCalled();
});
