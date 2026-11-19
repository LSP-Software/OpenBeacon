import { maxAccountSeats } from "@openbeacon/api/limits.ts";
import { z } from "zod";

export const seatsUsage = `Usage:
  seats show <email>
  seats set <email> <seats>

<seats> is a whole number from 0 to ${maxAccountSeats}.`;

export const parseSeatsCommand = (
  args: string[],
):
  | { command: "show"; email: string }
  | { command: "set"; email: string; seats: number }
  | { command: "help" }
  | { command: "error"; message: string } => {
  const [command, email, value, ...rest] = args;
  if (command === undefined || command === "help") return { command: "help" };
  const unknown = { command: "error" as const, message: `Unknown command: ${args.join(" ")}` };
  if (!email || rest.length > 0) return unknown;
  if (command === "show") return value === undefined ? { command, email } : unknown;
  if (command !== "set" || value === undefined) return unknown;
  const parsed = z
    .string()
    .regex(/^\d{1,5}$/)
    .transform(Number)
    .pipe(z.number().max(maxAccountSeats))
    .safeParse(value);
  if (!parsed.success) {
    return {
      command: "error",
      message: `Seats must be a whole number from 0 to ${maxAccountSeats}, not ${value}`,
    };
  }
  return { command: "set", email, seats: parsed.data };
};
