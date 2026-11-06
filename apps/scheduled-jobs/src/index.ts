import { tryCatch } from "@openbeacon/shared";
import { runAccountDeletion } from "./jobs/accountDeletion.ts";
import { startScheduler } from "./scheduler.ts";
import { checkServices, closeServices } from "./services.ts";

const result = await tryCatch(checkServices());
if (result.error) {
  console.error("Scheduled job runner could not connect to its services");
  await closeServices();
  process.exit(1);
}

const stop = startScheduler([{ name: "account-deletion", delay: 60_000, run: runAccountDeletion }]);
console.log("Scheduled job runner started");
const keepAlive = setInterval(() => {}, 60_000);

const shutdown = async () => {
  clearInterval(keepAlive);
  await stop();
  await closeServices();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
