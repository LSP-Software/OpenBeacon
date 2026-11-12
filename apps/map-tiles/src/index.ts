import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { tryCatch } from "@openbeacon/shared";
import { createMapTilesClient, formatStatus } from "./client.ts";
import { publish, readMapStatus, rollback } from "./commands.ts";
import { parseClientEnv, parseEnv } from "./env.ts";
import { createR2Clients } from "./r2.ts";
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

const serve = () => {
  const env = parseEnv(process.env);
  const apiKey = env.MAP_TILES_API_KEY;

  if (!apiKey) {
    throw new Error("serve needs MAP_TILES_API_KEY (at least 32 characters)");
  }

  const context = { ...createR2Clients(env), env };
  const handler = createMapTilesHandler({
    apiKey,
    readMapStatus: () => readMapStatus(context),
    rollback: () => rollback(context),
    runUpdate: (options) => publish(context, options),
  });
  Bun.serve({ fetch: handler.fetch, port: env.MAP_TILES_PORT });
  console.log(
    `Map tiles service listening on port ${env.MAP_TILES_PORT} for bucket ${env.R2_BUCKET}`,
  );
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

  const client = createMapTilesClient(parseClientEnv(process.env));

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
