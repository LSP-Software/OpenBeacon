import { limits, maxAccountSeats } from "@openbeacon/api/limits.ts";
import { z } from "zod";

const maxHoursAgo = 24 * 366;

export const seatsUsage = `Usage:
  seats show <email>
  seats set <email> <seats>
  seats end-period <email> [hours-ago]
  seats renew <email>
  seats reset-grace <email>

<seats> is a whole number from 0 to ${maxAccountSeats}.
end-period ends the account's paid period now, or [hours-ago] hours ago (up to ${maxHoursAgo}).
The account keeps its seats for a ${limits.gracePeriodDays}-day grace period, at most once every ${limits.graceCooldownMonths} months, then has 0.
renew clears the paid period's end. reset-grace forgets the last grace period, so the next
end-period gets one again.`;

const wholeNumber = (max: number) =>
  z
    .string()
    .regex(/^\d{1,5}$/)
    .transform(Number)
    .pipe(z.number().max(max));

export const parseSeatsCommand = (
  args: string[],
):
  | { command: "show" | "renew" | "reset-grace"; email: string }
  | { command: "set"; email: string; seats: number }
  | { command: "end-period"; email: string; hoursAgo: number }
  | { command: "help" }
  | { command: "error"; message: string } => {
  const [command, email, value, ...rest] = args;
  if (command === undefined || command === "help") return { command: "help" };
  const unknown = { command: "error" as const, message: `Unknown command: ${args.join(" ")}` };
  if (!email || rest.length > 0) return unknown;
  if ((command === "show" || command === "renew" || command === "reset-grace") && !value) {
    return value === undefined ? { command, email } : unknown;
  }
  if (command === "end-period") {
    if (value === undefined) return { command, email, hoursAgo: 0 };
    const parsed = wholeNumber(maxHoursAgo).safeParse(value);
    return parsed.success
      ? { command, email, hoursAgo: parsed.data }
      : {
          command: "error",
          message: `Hours ago must be a whole number from 0 to ${maxHoursAgo}, not ${value}`,
        };
  }
  if (command !== "set" || value === undefined) return unknown;
  const parsed = wholeNumber(maxAccountSeats).safeParse(value);
  if (!parsed.success) {
    return {
      command: "error",
      message: `Seats must be a whole number from 0 to ${maxAccountSeats}, not ${value}`,
    };
  }
  return { command: "set", email, seats: parsed.data };
};
