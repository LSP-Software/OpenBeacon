import {
  beginAccountDeletion,
  deleteAccountRecords,
  lockDeletableGroups,
} from "@openbeacon/api/account-deletion.ts";
import { Prisma } from "@openbeacon/database";
import { env } from "@openbeacon/api/env.ts";
import { tryCatch } from "@openbeacon/shared";
import { closeServices, services } from "./services.ts";

const email = process.argv[2]?.trim();
if (!email || process.argv.length !== 3) {
  console.error("Usage: bun run delete-account <email>");
  await closeServices();
  process.exit(1);
}

let started = false;
const result = await tryCatch(
  (async () => {
    const user = await services.db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error("Account not found.");
    const imageUrlPrefix = `${env.S3_CDN_URL}/${env.S3_BUCKET_NAME}`;
    await services.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${user.id} FOR NO KEY UPDATE`);
      await lockDeletableGroups(tx, { userId: user.id, imageUrlPrefix });
      await beginAccountDeletion(tx, { userId: user.id, delayHours: 0 });
    });
    started = true;
    const deleted = await deleteAccountRecords({
      db: services.db,
      userId: user.id,
      mode: "scheduled",
      imageUrlPrefix,
      securityAlerts: null,
    });
    if (
      !deleted &&
      (await services.db.user.findUnique({ where: { id: user.id }, select: { id: true } }))
    )
      throw new Error("Account deletion is waiting for the scheduled job runner.");
  })(),
);
await closeServices();
if (result.error) {
  console.error(
    started
      ? `Account deletion started but didn't finish: ${result.error.message} The scheduled job runner will finish it.`
      : `Account deletion failed: ${result.error.message}`,
  );
  process.exit(1);
}
console.log("Account deleted. Image cleanup will run in the scheduled job runner.");
