import { parseArgs } from "node:util";
import { tryCatch } from "@openbeacon/shared";
import { adopt, type Context, publish, rollback, status } from "./commands.ts";
import { parseEnv } from "./env.ts";
import { createR2Clients } from "./r2.ts";
import { createMapTilesHandler } from "./server.ts";

const usage = `Usage: bun run map-tiles <command> [options]

Commands:
  status                    Show both map slots, untracked archives and resumable uploads
  publish [--date YYYYMMDD] Replace the standby slot with a Protomaps build and switch to it
  adopt <key>               Create the first manifest for an archive already in R2
  rollback                  Switch back to the map in the standby slot
  serve                     Run the update service the scheduled job runner calls

Options:
  --bucket <name>  Required for changes; must match R2_BUCKET
  --dry-run        Show what would happen without writing to R2
  --yes            Skip confirmation prompts`;

export const assertWriteTarget = ({
  bucket,
  configuredBucket,
}: {
  bucket: string | undefined;
  configuredBucket: string;
}) => {
  if (bucket !== configuredBucket) {
    throw new Error(
      `Refusing to write: pass --bucket ${configuredBucket} to confirm the target bucket`,
    );
  }
};

const serve = (context: Context) => {
  const apiKey = context.env.MAP_TILES_API_KEY;

  if (!apiKey) {
    throw new Error("serve needs MAP_TILES_API_KEY (at least 32 characters)");
  }

  const handler = createMapTilesHandler({
    apiKey,
    runUpdate: () =>
      publish(
        { ...context, dryRun: false, yes: true },
        { date: undefined, minIntervalMs: context.env.updateIntervalMs },
      ),
  });
  Bun.serve({ fetch: handler.fetch, port: context.env.MAP_TILES_PORT });
  console.log(
    `Map tiles service listening on port ${context.env.MAP_TILES_PORT} for bucket ${context.env.R2_BUCKET}`,
  );
};

const run = async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      bucket: { type: "string" },
      date: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });
  const [command, argument] = positionals;

  if (values.help || !command) {
    console.log(usage);
    return;
  }

  if (values.date !== undefined && !/^\d{8}$/.test(values.date)) {
    throw new Error("--date must be YYYYMMDD");
  }

  const env = parseEnv(process.env);
  const context = {
    ...createR2Clients(env),
    dryRun: values["dry-run"],
    env,
    yes: values.yes,
  };

  if (command === "serve") {
    return serve(context);
  }

  if (command !== "status" && !context.dryRun) {
    assertWriteTarget({ bucket: values.bucket, configuredBucket: env.R2_BUCKET });
  }

  switch (command) {
    case "status":
      return status(context);
    case "publish": {
      const result = await publish(context, { date: values.date });
      console.log(result.message);
      return;
    }
    case "adopt":
      if (!argument) {
        throw new Error("adopt needs the key of the archive in R2");
      }
      return adopt(context, argument, values.date);
    case "rollback":
      return rollback(context);
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
