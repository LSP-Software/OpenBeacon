import { tryCatch } from "@openbeacon/shared";
import { getDatabaseTime } from "../databaseTime.ts";
import { errorCode } from "../errorCode.ts";
import { services } from "../services.ts";

const day = 24 * 60 * 60_000;

export const runExpiredRecordsCleanup = async () => {
  const now = await getDatabaseTime();
  const nowIso = now.toISOString();
  const dayAgo = new Date(now.getTime() - day).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * day).toISOString();
  const steps = [
    {
      table: "Verification",
      run: () => services.db.verification.deleteMany({ where: { expiresAt: { lt: now } } }),
    },
    {
      table: "Session",
      run: () =>
        deleteInBatches(
          () => services.db.$executeRaw`
            DELETE FROM "Session" WHERE id IN (
              SELECT id FROM "Session"
              WHERE "expiresAt" < (${nowIso}::timestamptz AT TIME ZONE 'UTC')
              LIMIT 1000
            )
          `,
        ),
    },
    {
      table: "GoogleDeletionChallenge",
      run: () =>
        deleteInBatches(
          () => services.db.$executeRaw`
            DELETE FROM "GoogleDeletionChallenge" WHERE id IN (
              SELECT id FROM "GoogleDeletionChallenge"
              WHERE "expiresAt" < (${nowIso}::timestamptz AT TIME ZONE 'UTC')
              LIMIT 1000
            )
          `,
        ),
    },
    {
      table: "GroupSharedInvite",
      run: () =>
        deleteInBatches(
          () => services.db.$executeRaw`
            DELETE FROM "GroupSharedInvite" WHERE id IN (
              SELECT id FROM "GroupSharedInvite"
              WHERE "expiresAt" < (${dayAgo}::timestamptz AT TIME ZONE 'UTC')
              LIMIT 1000
            )
          `,
        ),
    },
    {
      table: "GroupJoinAlert",
      run: () =>
        deleteInBatches(
          () => services.db.$executeRaw`
            DELETE FROM "GroupJoinAlert" WHERE id IN (
              SELECT a.id FROM "GroupJoinAlert" a
              WHERE a."createdAt" < (${monthAgo}::timestamptz AT TIME ZONE 'UTC')
                OR NOT EXISTS (
                  SELECT 1 FROM "GroupMember" m
                  WHERE m."userId" = a."recipientId" AND m."groupId" = a."groupId"
                )
              LIMIT 1000
            )
          `,
        ),
    },
    {
      table: "GroupMemberInvite",
      run: () =>
        deleteInBatches(
          () => services.db.$executeRaw`
            DELETE FROM "GroupMemberInvite" WHERE id IN (
              SELECT i.id FROM "GroupMemberInvite" i
              WHERE i."createdAt" < (${monthAgo}::timestamptz AT TIME ZONE 'UTC')
                OR NOT EXISTS (
                  SELECT 1 FROM "GroupMember" m
                  WHERE m."userId" = i."inviterId" AND m."groupId" = i."groupId"
                )
              LIMIT 1000
            )
          `,
        ),
    },
    {
      table: "Feedback",
      run: () =>
        deleteInBatches(
          () => services.db.$executeRaw`
            DELETE FROM "Feedback" WHERE id IN (
              SELECT id FROM "Feedback"
              WHERE "createdAt" < (${monthAgo}::timestamptz AT TIME ZONE 'UTC')
              LIMIT 1000
            )
          `,
        ),
    },
  ];
  for (const { table, run } of steps) {
    const result = await tryCatch<unknown>(run());
    if (!result.error) continue;
    const code = errorCode(result.error);
    console.error(`Expired records clean-up failed for ${table}${code ? ` (${code})` : ""}`);
  }
};

const deleteInBatches = async (deleteBatch: () => Promise<number>) => {
  for (let batch = 0; batch < 10; batch++) {
    if ((await deleteBatch()) < 1000) return;
  }
};
