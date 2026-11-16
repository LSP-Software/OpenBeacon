import { describe, expect, test } from "bun:test";
import { parseAnnounceCommand } from "./announceCommand.ts";

const now = new Date("2026-11-20T12:00:00.000Z");

const add = (...args: string[]) =>
  parseAnnounceCommand(["add", "--message", "Down soon", ...args], now);

const errorOf = (result: ReturnType<typeof parseAnnounceCommand>) =>
  result.command === "error" ? result.message : null;

describe("parseAnnounceCommand", () => {
  test("adds an announcement for everyone that starts now and lasts --for", () => {
    expect(add("--for", "90m")).toEqual({
      command: "add",
      announcement: {
        message: "Down soon",
        severity: "INFO",
        platform: null,
        minAppVersion: null,
        maxAppVersion: null,
        downtimeStartsAt: null,
        downtimeEndsAt: null,
        startsAt: now,
        endsAt: new Date("2026-11-20T13:30:00.000Z"),
      },
    });
  });

  test("targets a platform and a version range and keeps showing until the downtime ends", () => {
    const result = add(
      "--severity",
      "warning",
      "--platform",
      "ios",
      "--min-version",
      "1.9.0",
      "--max-version",
      "1.20.0",
      "--from",
      "2026-11-20T18:00Z",
      "--downtime-start",
      "2026-11-21T09:00+01:00",
      "--downtime-end",
      "2026-11-21T10:30+01:00",
    );
    expect(result).toEqual({
      command: "add",
      announcement: {
        message: "Down soon",
        severity: "WARNING",
        platform: "IOS",
        minAppVersion: "1.9.0",
        maxAppVersion: "1.20.0",
        downtimeStartsAt: new Date("2026-11-21T08:00:00.000Z"),
        downtimeEndsAt: new Date("2026-11-21T09:30:00.000Z"),
        startsAt: new Date("2026-11-20T18:00:00.000Z"),
        endsAt: new Date("2026-11-21T09:30:00.000Z"),
      },
    });
  });

  test("trims the message and rejects one over 280 characters", () => {
    const trimmed = parseAnnounceCommand(["add", "--message", "  Hi  ", "--for", "1h"], now);
    expect(trimmed.command === "add" && trimmed.announcement.message).toBe("Hi");
    expect(
      errorOf(parseAnnounceCommand(["add", "--message", "a".repeat(281), "--for", "1h"], now)),
    ).toStartWith("--message");
  });

  test.each([
    [["--for", "1h", "--until", "2026-11-20T14:00Z"], "Give --until or --for, not both"],
    [[], "Say when to stop showing it with --until, --for or --downtime-end"],
    [["--until", "2026-11-20T11:00Z"], "It would stop showing before it starts"],
    [
      ["--from", "2026-11-21T00:00Z", "--until", "2026-11-20T18:00Z"],
      "It would stop showing before it starts",
    ],
    [
      ["--for", "1h", "--min-version", "1.10.0", "--max-version", "1.9.0"],
      "--min-version is newer than --max-version",
    ],
    [
      ["--downtime-start", "2026-11-21T09:00Z"],
      "Give both --downtime-start and --downtime-end, or neither",
    ],
    [
      ["--downtime-start", "2026-11-21T09:00Z", "--downtime-end", "2026-11-21T09:00Z"],
      "--downtime-end must be after --downtime-start",
    ],
    [
      ["--downtime-start", "2026-11-20T09:00Z", "--downtime-end", "2026-11-20T11:00Z"],
      "--downtime-end is in the past, so the downtime is over",
    ],
    [["--for", "91d"], "An announcement can show for at most 90 days from now"],
    [["--until", "2027-02-18T12:00:01Z"], "An announcement can show for at most 90 days from now"],
    [
      ["--from", "2027-02-01T00:00Z", "--for", "30d"],
      "An announcement can show for at most 90 days from now",
    ],
  ])("rejects %j", (args, message) => {
    expect(errorOf(add(...args))).toBe(message);
  });

  test("allows an announcement to show for exactly 90 days", () => {
    expect(add("--for", "90d").command).toBe("add");
    expect(add("--until", "2027-02-18T12:00Z").command).toBe("add");
  });

  test.each([
    ["2026-13-01T09:00Z", "That date doesn't exist"],
    ["2026-00-01T09:00Z", "That date doesn't exist"],
    ["2026-11-00T09:00Z", "That date doesn't exist"],
    ["2026-11-21T25:00Z", "That time doesn't exist"],
    ["2026-11-21T24:00Z", "That time doesn't exist"],
    ["2026-11-21T09:99Z", "That time doesn't exist"],
    ["2026-11-21T09:00:60Z", "That time doesn't exist"],
    ["2026-11-21T09:00+99:00", "That time zone offset doesn't exist"],
    ["2026-11-21T09:00+15:00", "That time zone offset doesn't exist"],
    ["2026-11-21T09:00+01:60", "That time zone offset doesn't exist"],
  ])("rejects the impossible time %s", (time, message) => {
    expect(errorOf(add("--until", time))).toBe(`--until: ${message}`);
  });

  test("accepts seconds, fractions and the largest offsets", () => {
    expect(add("--until", "2026-11-21T23:59:59.5Z").command).toBe("add");
    expect(add("--until", "2026-11-21T09:00+14:00").command).toBe("add");
    expect(add("--until", "2026-11-21T09:00-12:00").command).toBe("add");
  });

  test.each([
    ["--until", "2026-11-21 09:00"],
    ["--until", "2026-11-21T09:00"],
    ["--until", "2027-02-29T09:00Z"],
    ["--for", "2w"],
    ["--from", "2026-11-31T09:00Z"],
    ["--platform", "web"],
    ["--min-version", "1.2"],
    ["--severity", "critical"],
  ])("rejects %s %s", (option, value) => {
    expect(errorOf(add(option, value))).toStartWith(option);
  });

  test("rejects options it doesn't know", () => {
    expect(errorOf(add("--for", "1h", "--link", "https://example.com"))).toContain("--link");
  });

  test("lists, ends by id and shows help", () => {
    expect(parseAnnounceCommand(["list"], now)).toEqual({ command: "list" });
    expect(parseAnnounceCommand(["end", "abc"], now)).toEqual({ command: "end", id: "abc" });
    expect(parseAnnounceCommand([], now)).toEqual({ command: "help" });
    expect(parseAnnounceCommand(["help"], now)).toEqual({ command: "help" });
    expect(errorOf(parseAnnounceCommand(["end"], now))).toBe("Unknown command: end");
    expect(errorOf(parseAnnounceCommand(["list", "--for", "1h"], now))).toBe(
      "Unknown command: list",
    );
  });
});
