import { deleteAccountNow } from "@openbeacon/api/account-deletion.ts";
import { env } from "@openbeacon/api/env.ts";
import { tryCatch } from "@openbeacon/shared";
import { closeServices, services } from "./services.ts";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || process.argv.length !== 3) {
  console.error("Usage: bun run delete-account <email>");
  await closeServices();
  process.exit(1);
}

const result = await tryCatch(
  (async () => {
    const user = await services.db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error("Account not found.");
    const deletion = await deleteAccountNow({
      db: services.db,
      userId: user.id,
      imageUrlPrefix: `${env.IMAGES_S3_CDN_URL}/${env.IMAGES_S3_BUCKET_NAME}`,
    });
    if (deletion.error) return deletion.error.message;
    if (
      !deletion.data &&
      (await services.db.user.findUnique({ where: { id: user.id }, select: { id: true } }))
    )
      return "Account deletion is waiting for the scheduled job runner.";
    return null;
  })(),
);
await closeServices();
if (result.error) {
  console.error(`Account deletion failed: ${result.error.message}`);
  process.exit(1);
}
if (result.data !== null) {
  console.error(
    `Account deletion started but didn't finish: ${result.data} The scheduled job runner will finish it.`,
  );
  process.exit(1);
}
console.log("Account deleted. Image cleanup will run in the scheduled job runner.");
