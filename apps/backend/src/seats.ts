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
const { freeSeats } = await import("@openbeacon/api/seats.ts");
const { envSchema } = await import("./envSchema.ts");

const selfHosted = envSchema.SELF_HOSTED.safeParse(process.env["SELF_HOSTED"]).data !== false;
const user = await prisma.user.findUnique({
  where: { email: parsed.email.toLowerCase() },
  select: { id: true },
});
if (!user) {
  console.error(`No account has the email ${parsed.email}.`);
  process.exitCode = 1;
} else {
  if (parsed.command === "set") {
    await prisma.user.update({ where: { id: user.id }, data: { seats: parsed.seats } });
  }
  const { seats, used } = await freeSeats(prisma, user.id);
  console.log(
    `${parsed.command === "set" ? `Set ${seats} seats. ` : ""}Has ${seats} seats, using ${used}${used > seats ? `, which is ${used - seats} more than it has` : ""}.`,
  );
  if (selfHosted) console.log("This server is self-hosted, so seats aren't enforced.");
}

await prisma.$disconnect();
