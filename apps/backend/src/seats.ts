import { parseSeatsCommand, seatsUsage } from "./seatsCommand.ts";

const parsed = parseSeatsCommand(process.argv.slice(2));

if (parsed.command === "help") {
  console.log(seatsUsage);
  process.exit(0);
}
if (parsed.command === "error") {
  console.error(`${parsed.message}\n\n${seatsUsage}`);
  process.exit(1);
}

const { prisma } = await import("@openbeacon/database");
const { accountSeats, seatsUsed } = await import("@openbeacon/api/seats.ts");
const { envSchema } = await import("./envSchema.ts");

const user = await prisma.user.findUnique({
  where: { email: parsed.email.toLowerCase() },
  select: { id: true },
});
if (!user) {
  console.error(`No account has the email ${parsed.email}.`);
  process.exitCode = 1;
} else {
  const seats =
    parsed.command === "set"
      ? (
          await prisma.user.update({
            where: { id: user.id },
            data: { seats: parsed.seats },
            select: { seats: true },
          })
        ).seats
      : await accountSeats(prisma, user.id);
  const used = await seatsUsed(prisma, user.id);
  console.log(
    `${parsed.command === "set" ? "Set" : "Has"} ${seats} seats, using ${used}${used > seats ? `, which is ${used - seats} more than it has` : ""}.`,
  );
  if (envSchema.SELF_HOSTED.safeParse(process.env["SELF_HOSTED"]).data !== false) {
    console.log("This server is self-hosted, so seats aren't enforced.");
  }
}

await prisma.$disconnect();
