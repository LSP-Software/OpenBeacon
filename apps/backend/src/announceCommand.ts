import { parseArgs } from "node:util";
import {
  announcementMessageSchema,
  announcementSchema,
  appVersionSchema,
  compareAppVersions,
  devicePlatformSchema,
} from "@openbeacon/schemas";
import { z } from "zod";

const timeSchema = z.string().transform((value, context) => {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) {
    context.addIssue({
      code: "custom",
      message: "Give times as ISO 8601 with a time zone, such as 2026-11-21T09:00Z",
    });
    return z.NEVER;
  }
  const [
    year = 0,
    month = 0,
    day = 0,
    hour = 0,
    minute = 0,
    second = 0,
    offsetHours = 0,
    offsetMinutes = 0,
  ] = match.slice(1).map((part) => Number(part ?? 0));
  const problem =
    month < 1 || month > 12 || new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day
      ? "That date doesn't exist"
      : hour > 23 || minute > 59 || second > 59
        ? "That time doesn't exist"
        : offsetHours > 14 || offsetMinutes > 59
          ? "That time zone offset doesn't exist"
          : null;
  if (problem) {
    context.addIssue({ code: "custom", message: problem });
    return z.NEVER;
  }
  return new Date(value);
});

const durationSchema = z
  .string()
  .regex(/^\d{1,4}[mhd]$/, {
    message: "Give --for as a number of minutes, hours or days, such as 90m, 2h or 1d",
  })
  .transform(
    (value) =>
      Number(value.slice(0, -1)) *
      (value.endsWith("d") ? 86_400_000 : value.endsWith("h") ? 3_600_000 : 60_000),
  );

const addOptionsSchema = z.object({
  message: announcementMessageSchema,
  severity: announcementSchema.shape.severity.default("info"),
  platform: devicePlatformSchema.optional(),
  "min-version": appVersionSchema.optional(),
  "max-version": appVersionSchema.optional(),
  "downtime-start": timeSchema.optional(),
  "downtime-end": timeSchema.optional(),
  from: timeSchema.optional(),
  until: timeSchema.optional(),
  for: durationSchema.optional(),
});

export const announceUsage = `Usage:
  announce add --message <text> (--until <time> | --for <duration> | --downtime-end <time>) [options]
  announce list
  announce end <id>

Options for add:
  --message <text>         One line of plain text, up to 280 characters
  --severity info|warning  Defaults to info
  --platform android|ios   Show only on one platform
  --min-version <x.y.z>    Show only on this app version or newer
  --max-version <x.y.z>    Show only on this app version or older
  --downtime-start <time>  When planned downtime starts, shown in each person's local time
  --downtime-end <time>    When planned downtime ends
  --from <time>            When to start showing it, defaults to now
  --until <time>           When to stop showing it, at most 90 days from now
  --for <duration>         How long to show it for, such as 90m, 2h or 1d

Times are ISO 8601 with a time zone, such as 2026-11-21T09:00Z or 2026-11-21T09:00+01:00.`;

export const parseAnnounceCommand = (
  args: string[],
  now: Date,
):
  | {
      command: "add";
      announcement: {
        message: string;
        severity: "INFO" | "WARNING";
        platform: "ANDROID" | "IOS" | null;
        minAppVersion: string | null;
        maxAppVersion: string | null;
        downtimeStartsAt: Date | null;
        downtimeEndsAt: Date | null;
        startsAt: Date;
        endsAt: Date;
      };
    }
  | { command: "list" }
  | { command: "end"; id: string }
  | { command: "help" }
  | { command: "error"; message: string } => {
  const readArgs = () => {
    try {
      return parseArgs({
        args,
        allowPositionals: true,
        strict: true,
        options: Object.fromEntries(
          Object.keys(addOptionsSchema.shape).map((name) => [name, { type: "string" } as const]),
        ),
      });
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  };
  const parsed = readArgs();
  if (parsed instanceof Error) return { command: "error", message: parsed.message };
  const [command, ...rest] = parsed.positionals;
  const hasOptions = Object.keys(parsed.values).length > 0;

  if (command === "list" && rest.length === 0 && !hasOptions) return { command: "list" };
  if (command === "end" && rest.length === 1 && rest[0] && !hasOptions) {
    return { command: "end", id: rest[0] };
  }
  if (command !== "add" || rest.length > 0) {
    return command === undefined || command === "help"
      ? { command: "help" }
      : { command: "error", message: `Unknown command: ${parsed.positionals.join(" ")}` };
  }

  const options = addOptionsSchema.safeParse(parsed.values);
  if (!options.success) {
    const issue = options.error.issues[0];
    return {
      command: "error",
      message: `--${issue?.path.join(".") ?? "options"}: ${issue?.message ?? "invalid"}`,
    };
  }
  const values = options.data;
  const minAppVersion = values["min-version"] ?? null;
  const maxAppVersion = values["max-version"] ?? null;
  const downtimeStartsAt = values["downtime-start"] ?? null;
  const downtimeEndsAt = values["downtime-end"] ?? null;
  const startsAt = values.from ?? now;

  if (minAppVersion && maxAppVersion && compareAppVersions(minAppVersion, maxAppVersion) > 0) {
    return { command: "error", message: "--min-version is newer than --max-version" };
  }
  if ((downtimeStartsAt === null) !== (downtimeEndsAt === null)) {
    return {
      command: "error",
      message: "Give both --downtime-start and --downtime-end, or neither",
    };
  }
  if (downtimeStartsAt && downtimeEndsAt && downtimeEndsAt <= downtimeStartsAt) {
    return { command: "error", message: "--downtime-end must be after --downtime-start" };
  }
  if (downtimeEndsAt && downtimeEndsAt <= now) {
    return { command: "error", message: "--downtime-end is in the past, so the downtime is over" };
  }
  if (values.until && values.for !== undefined) {
    return { command: "error", message: "Give --until or --for, not both" };
  }
  const endsAt =
    values.until ??
    (values.for !== undefined ? new Date(startsAt.getTime() + values.for) : downtimeEndsAt);
  if (!endsAt) {
    return {
      command: "error",
      message: "Say when to stop showing it with --until, --for or --downtime-end",
    };
  }
  if (endsAt <= startsAt || endsAt <= now) {
    return { command: "error", message: "It would stop showing before it starts" };
  }
  if (endsAt.getTime() > now.getTime() + 90 * 86_400_000) {
    return { command: "error", message: "An announcement can show for at most 90 days from now" };
  }

  return {
    command: "add",
    announcement: {
      message: values.message,
      severity: values.severity === "warning" ? "WARNING" : "INFO",
      platform:
        values.platform === undefined ? null : values.platform === "ios" ? "IOS" : "ANDROID",
      minAppVersion,
      maxAppVersion,
      downtimeStartsAt,
      downtimeEndsAt,
      startsAt,
      endsAt,
    },
  };
};
