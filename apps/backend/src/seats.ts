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
const { seatAccountSelect, seatPeriod, seatsUsed } = await import("@openbeacon/api/seats.ts");
const { envSchema } = await import("./envSchema.ts");

const selfHosted = envSchema.SELF_HOSTED.safeParse(process.env["SELF_HOSTED"]).data !== false;
const user = await prisma.user.findUnique({
  where: { email: parsed.email.toLowerCase() },
  select: { id: true },
});
if (!user) {
  console.error(`No account has the email ${parsed.email}.`);
  process.exitCode = 1;
} else if (parsed.command === "end-period" && selfHosted) {
  console.error("This server is self-hosted, so it has no paid periods.");
  process.exitCode = 1;
} else {
  const data =
    parsed.command === "set"
      ? { seats: parsed.seats }
      : parsed.command === "end-period"
        ? { paidPeriodEndsAt: new Date(Date.now() - parsed.hoursAgo * 3_600_000) }
        : parsed.command === "renew"
          ? { paidPeriodEndsAt: null }
          : parsed.command === "reset-grace"
            ? { lastGracePeriodStartedAt: null }
            : null;
  const account = data
    ? await prisma.user.update({ where: { id: user.id }, data, select: seatAccountSelect })
    : await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: seatAccountSelect });
  const { grace, seats } = seatPeriod(account, new Date());
  const used = await seatsUsed(prisma, user.id);
  console.log(
    `${parsed.command === "set" ? `Set ${account.seats} seats. ` : ""}Has ${seats} seats, using ${used}${used > seats ? `, which is ${used - seats} more than it has` : ""}.`,
  );
  if (account.paidPeriodEndsAt) {
    console.log(
      grace
        ? `The paid period ended at ${account.paidPeriodEndsAt.toISOString()}. Its grace period ends at ${grace.endsAt.toISOString()}, then it has 0 seats.`
        : account.paidPeriodEndsAt > new Date()
          ? `The paid period ends at ${account.paidPeriodEndsAt.toISOString()}.`
          : `The paid period ended at ${account.paidPeriodEndsAt.toISOString()} and its grace period is over or wasn't given.`,
    );
  }
  if (account.lastGracePeriodStartedAt) {
    console.log(`Last grace period started at ${account.lastGracePeriodStartedAt.toISOString()}.`);
  }
  if (selfHosted) console.log("This server is self-hosted, so seats aren't enforced.");
}

await prisma.$disconnect();
