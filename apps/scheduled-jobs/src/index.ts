import "./env.ts";
import { tryCatch } from "@openbeacon/shared";
import { startHealthServer } from "./health.ts";
import { jobs } from "./jobs/index.ts";
import { startScheduler } from "./scheduler.ts";
import { checkServices, closeServices } from "./services.ts";

const result = await tryCatch(checkServices());
if (result.error) {
  console.error("Scheduled job runner could not connect to its services");
  await closeServices();
  process.exit(1);
}

const stop = startScheduler(jobs);
const healthServer = startHealthServer(3000);
console.log("Scheduled job runner started");

const shutdown = async () => {
  await healthServer.stop();
  await stop();
  await closeServices();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
