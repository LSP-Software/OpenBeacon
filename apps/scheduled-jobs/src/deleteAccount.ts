import { deleteAccountRecords } from "@openbeacon/api/account-deletion.ts";
import { env } from "@openbeacon/api/env.ts";
import { tryCatch } from "@openbeacon/shared";
import { closeServices, services } from "./services.ts";

const email = process.argv[2]?.trim();
if (!email || process.argv.length !== 3) {
  console.error("Usage: bun run delete-account <email>");
  await closeServices();
  process.exit(1);
}

const result = await tryCatch(
  (async () => {
    const user = await services.db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error("Account not found.");
    const deleted = await deleteAccountRecords({
      db: services.db,
      userId: user.id,
      mode: "immediate",
      imageUrlPrefix: `${env.S3_CDN_URL}/${env.S3_BUCKET_NAME}`,
      securityAlerts: null,
    });
    if (!deleted) throw new Error("Account not found.");
  })(),
);
await closeServices();
if (result.error) {
  console.error(`Account deletion failed: ${result.error.message}`);
  process.exit(1);
}
console.log("Account deleted. Image cleanup will run in the scheduled job runner.");
