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
  const [command, email, seats, ...rest] = args;
  if (command === undefined || command === "help") return { command: "help" };
  if (command === "show" && email && seats === undefined) return { command: "show", email };
  if (command !== "set" || !email || seats === undefined || rest.length > 0) {
    return { command: "error", message: `Unknown command: ${args.join(" ")}` };
  }
  const parsed = z
    .string()
    .regex(/^\d{1,5}$/)
    .transform(Number)
    .pipe(z.number().max(maxAccountSeats))
    .safeParse(seats);
  if (!parsed.success) {
    return {
      command: "error",
      message: `Seats must be a whole number from 0 to ${maxAccountSeats}, not ${seats}`,
    };
  }
  return { command: "set", email, seats: parsed.data };
};
