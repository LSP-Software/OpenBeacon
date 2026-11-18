import { tryCatch } from "@openbeacon/shared";
import { closeServices, services } from "./services.ts";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || process.argv.length !== 3) {
  console.error("Usage: bun run turn-off-sign-in-codes <email>");
  await closeServices();
  process.exit(1);
}

const result = await tryCatch(
  (async () => {
    const user = await services.db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return null;
    const changed = await services.db.user.updateMany({
      where: { id: user.id, signInCodes: true },
      data: { signInCodes: false },
    });
    return changed.count === 1 ? user : null;
  })(),
);
const user = result.data;
if (user) services.securityAlerts.send(user.id, { type: "sign-in-codes-turned-off" });
await closeServices();
if (result.error) {
  console.error(`Couldn't turn off sign-in codes: ${result.error.message}`);
  process.exit(1);
}
console.log(
  user
    ? "Sign-in codes are off. The account can sign in with just its password."
    : "No account with that email has sign-in codes on.",
);
