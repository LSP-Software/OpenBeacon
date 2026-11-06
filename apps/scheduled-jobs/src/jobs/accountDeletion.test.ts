import { afterAll, beforeEach, expect, mock, test } from "bun:test";

let databaseNow = new Date("2038-04-05T12:00:00.000Z");
const getDatabaseTime = mock(async () => [{ now: databaseNow }]);
const findUsers = mock(async (_args: unknown) => [{ id: "due" }, { id: "blocked" }]);
const findCleanup = mock(async (_args: unknown) => [
  { userId: "clean", imageKeys: [] },
  { userId: "retry", imageKeys: [] },
]);
const retryAccount = mock(async (_input: unknown) => ({ count: 1 }));
const retryCleanup = mock(async (_input: unknown) => ({ count: 1 }));
const removeCleanup = mock(async (_input: unknown) => ({ count: 1 }));
const removeAccount = mock(async (input: { userId: string }) => {
  if (input.userId === "blocked") throw new Error("Owner guard");
  return true;
});
const removeImages = mock(async (_bucket: string, userId: string) => {
  if (userId === "retry") throw new Error("Storage unavailable");
});
const removeImageKey = mock(async (_bucket: string, _key: string) => {});
const logError = mock(() => {});

mock.module("@openbeacon/api/account-deletion.ts", () => ({ deleteAccountRecords: removeAccount }));
mock.module("@openbeacon/api/env.ts", () => ({
  env: { S3_CDN_URL: "https://cdn.example", S3_BUCKET_NAME: "bucket" },
}));
mock.module("@openbeacon/api/storage.ts", () => ({
  deleteUserImages: removeImages,
  deleteImageKey: removeImageKey,
}));
mock.module("../services.ts", () => ({
  services: {
    db: {
      $queryRaw: getDatabaseTime,
      user: { findMany: findUsers, updateMany: retryAccount },
      accountDeletionCleanup: {
        findMany: findCleanup,
        deleteMany: removeCleanup,
        updateMany: retryCleanup,
      },
    },
  },
}));
const { runAccountDeletion } = await import("./accountDeletion.ts");
const originalError = console.error;
afterAll(() => {
  console.error = originalError;
  mock.restore();
});
beforeEach(() => {
  databaseNow = new Date("2038-04-05T12:00:00.000Z");
  getDatabaseTime.mockClear();
  findUsers.mockClear();
  findCleanup.mockClear();
  removeCleanup.mockClear();
  retryAccount.mockClear();
  retryCleanup.mockClear();
  removeAccount.mockClear();
  removeImages.mockClear();
  removeImageKey.mockClear();
  logError.mockClear();
  console.error = logError;
});

test("cleans up recorded group image keys before removing the cleanup record", async () => {
  findCleanup.mockImplementationOnce(async () => [
    { userId: "clean", imageKeys: ["user/other/image"] },
  ]);
  await runAccountDeletion();
  expect(removeImageKey).toHaveBeenCalledWith("bucket", "user/other/image");
  expect(removeCleanup).toHaveBeenCalledWith({ where: { userId: "clean" } });
});

test("continues after an account failure and retains failed image cleanup for retry", async () => {
  await runAccountDeletion();
  expect(removeAccount.mock.calls.map(([input]) => input.userId)).toEqual(["due", "blocked"]);
  expect(removeAccount.mock.calls[0]?.[0]).toMatchObject({ mode: "scheduled" });
  expect(removeImages.mock.calls).toEqual([
    ["bucket", "clean"],
    ["bucket", "retry"],
  ]);
  expect(removeCleanup.mock.calls).toEqual([[{ where: { userId: "clean" } }]]);
  expect(retryAccount.mock.calls[0]?.[0]).toMatchObject({
    where: { id: "blocked", pendingDeletion: true },
    data: { deletionRetryAt: new Date(databaseNow.getTime() + 300_000) },
  });
  expect(retryCleanup.mock.calls[0]?.[0]).toMatchObject({
    where: { userId: "retry" },
    data: { retryAt: new Date(databaseNow.getTime() + 300_000) },
  });
  expect(logError).toHaveBeenCalledTimes(2);
});

test("uses database time for due selection and the image cleanup delay", async () => {
  await runAccountDeletion();
  const accountQuery = findUsers.mock.calls[0]?.[0] as {
    where: { pendingDeletion: boolean; deletionDate: { lte: Date }; OR: unknown[] };
    take: number;
  };
  const cleanupQuery = findCleanup.mock.calls[0]?.[0] as {
    where: { createdAt: { lte: Date }; OR: unknown[] };
    take: number;
  };
  expect(accountQuery.where.pendingDeletion).toBe(true);
  expect(accountQuery.where.deletionDate.lte).toEqual(databaseNow);
  expect(cleanupQuery.where.createdAt.lte.getTime()).toBe(
    accountQuery.where.deletionDate.lte.getTime() - 600_000,
  );
  expect(accountQuery.where.OR).toEqual([
    { deletionRetryAt: null },
    { deletionRetryAt: { lte: accountQuery.where.deletionDate.lte } },
  ]);
  expect(cleanupQuery.where.OR).toEqual([
    { retryAt: null },
    { retryAt: { lte: accountQuery.where.deletionDate.lte } },
  ]);
  expect(accountQuery.take).toBe(100);
  expect(cleanupQuery.take).toBe(100);
});

test("does not use an ahead-of-database runner clock for selecting work", async () => {
  databaseNow = new Date("2001-01-01T00:00:00.000Z");
  await runAccountDeletion();
  expect(findUsers.mock.calls[0]?.[0]).toMatchObject({
    where: { deletionDate: { lte: databaseNow } },
  });
  expect(findCleanup.mock.calls[0]?.[0]).toMatchObject({
    where: { createdAt: { lte: new Date(databaseNow.getTime() - 600_000) } },
  });
});

test("does not process accounts or images when database time is unavailable", async () => {
  getDatabaseTime.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(runAccountDeletion()).rejects.toThrow("database unavailable");
  expect(findUsers).not.toHaveBeenCalled();
  expect(removeAccount).not.toHaveBeenCalled();
  expect(findCleanup).not.toHaveBeenCalled();
  expect(removeImages).not.toHaveBeenCalled();
});
