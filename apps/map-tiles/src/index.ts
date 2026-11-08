import { parseArgs } from "node:util";
import { tryCatch } from "@openbeacon/shared";
import { adopt, prune, publish, rollback, status } from "./commands.ts";
import { parseEnv } from "./env.ts";
import { createR2Clients } from "./r2.ts";

const usage = `Usage: bun run map-tiles <command> [options]

Commands:
  status                    Show the manifest, untracked archives and resumable uploads
  publish [--date YYYYMMDD] Upload a Protomaps build and make it the current archive
  adopt <key>               Create the first manifest for an archive already in R2
  rollback                  Make the previous archive current again
  prune                     Delete archives that are no longer served

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

  if (command !== "status" && !context.dryRun) {
    assertWriteTarget({ bucket: values.bucket, configuredBucket: env.R2_BUCKET });
  }

  switch (command) {
    case "status":
      return status(context);
    case "publish":
      return publish(context, values.date);
    case "adopt":
      if (!argument) {
        throw new Error("adopt needs the key of the archive in R2");
      }
      return adopt(context, argument);
    case "rollback":
      return rollback(context);
    case "prune":
      return prune(context);
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
