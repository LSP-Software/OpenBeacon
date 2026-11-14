import { access, constants, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { checkServices, tryCatch, validateEnv } from "@openbeacon/shared";
import { createMapTilesClient, formatStatus } from "./client.ts";
import { publish, readMapStatus, repairManifest, rollback } from "./commands.ts";
import { envSchema, getServiceUrl, parseEnv } from "./env.ts";
import { checkBucketAccess, createStorageClients } from "./storage.ts";
import { createMapTilesHandler } from "./server.ts";

const usage = `Usage: map-tiles <command> [options]

Commands:
  status     Show which map slot is in use, both slots and the last update
  update     Start an update now, ignoring the update interval
  rollback   Switch back to the map in the other slot
  serve      Run the map tiles service

Options:
  --yes      Skip the rollback confirmation`;

const confirm = async ({ question, yes }: { question: string; yes: boolean }) => {
  if (yes) {
    return;
  }

  if (!process.stdin.isTTY) {
    throw new Error("Pass --yes to run without an interactive confirmation");
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await readline.question(`${question} [y/N] `);
  readline.close();

  if (answer.trim().toLowerCase() !== "y") {
    throw new Error("Cancelled");
  }
};

const serve = async () => {
  validateEnv({ schemas: envSchema, source: process.env });
  const env = parseEnv(process.env);
  const context = { ...createStorageClients(env), env };

  await checkServices({
    "Map storage": () =>
      checkBucketAccess({ bucket: env.MAP_S3_BUCKET_NAME, client: context.client }),
    "State directory": async () => {
      await mkdir(env.MAP_TILES_STATE_DIR, { recursive: true });
      await access(env.MAP_TILES_STATE_DIR, constants.W_OK);
    },
  });

  const handler = createMapTilesHandler({
    readMapStatus: () => readMapStatus(context),
    rollback: () => rollback(context),
    runUpdate: async (options) => {
      const repaired = await repairManifest(context);
      if (repaired) {
        console.log(repaired);
      }
      return publish(context, options);
    },
  });
  const server = Bun.serve({
    fetch: handler.fetch,
    hostname: "127.0.0.1",
    idleTimeout: 30,
    port: env.MAP_TILES_PORT,
  });
  console.log(
    `Map tiles API listening on 127.0.0.1:${env.MAP_TILES_PORT} for the map-tiles command`,
  );
  console.log(
    `Checking for a map update in map storage bucket ${env.MAP_S3_BUCKET_NAME} now and whenever the map is ${env.MAP_TILES_UPDATE_INTERVAL_DAYS} days old`,
  );
  const stopUpdates = handler.scheduleUpdates(env.updateIntervalMs);

  const shutdown = async () => {
    stopUpdates();
    await server.stop(true);
    console.log("Map tiles service stopped; an unfinished upload resumes on the next start");
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

const run = async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });
  const [command] = positionals;

  if (values.help || !command) {
    console.log(usage);
    return;
  }

  if (command === "serve") {
    return serve();
  }

  const client = createMapTilesClient({ serviceUrl: getServiceUrl(process.env) });

  switch (command) {
    case "status":
      console.log(formatStatus({ now: Date.now(), status: await client.status() }));
      return;
    case "update": {
      const result = await client.update();
      console.log(
        result.alreadyRunning
          ? `An update has been running since ${result.startedAt}`
          : "Update started. Follow it with `map-tiles status` or the service logs.",
      );
      return;
    }
    case "rollback": {
      const { map } = await client.status();
      const from = map.current;
      const to = from === "a" ? "b" : "a";
      const target = map.slots[to];

      if (!from || !target) {
        throw new Error("There is no map in the other slot to roll back to");
      }

      await confirm({
        question: `Switch from slot ${from.toUpperCase()} to slot ${to.toUpperCase()} (Protomaps build ${target.build})?`,
        yes: values.yes,
      });
      console.log(await client.rollback());
      return;
    }
    default:
      throw new Error(`Unknown command ${command}\n\n${usage}`);
  }
};

if (import.meta.main) {
  const result = await tryCatch(run());

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
}
