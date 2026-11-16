import { prisma } from "@openbeacon/database";
import { announceUsage, parseAnnounceCommand } from "./announceCommand.ts";

const now = new Date();
const parsed = parseAnnounceCommand(process.argv.slice(2), now);

if (parsed.command === "help") {
  console.log(announceUsage);
} else if (parsed.command === "error") {
  console.error(`${parsed.message}\n\n${announceUsage}`);
  process.exitCode = 1;
} else if (parsed.command === "add") {
  const created = await prisma.announcement.create({ data: parsed.announcement });
  console.log(
    `Added announcement ${created.id}, shown from ${created.startsAt.toISOString()} to ${created.endsAt.toISOString()}. Apps pick it up the next time they check in with the server.`,
  );
} else if (parsed.command === "list") {
  const announcements = await prisma.announcement.findMany({
    where: { endsAt: { gt: now } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
  if (announcements.length === 0) console.log("No current or upcoming announcements.");
  for (const announcement of announcements) {
    const audience = [
      announcement.platform?.toLowerCase() ?? "all platforms",
      announcement.minAppVersion ? `>= ${announcement.minAppVersion}` : null,
      announcement.maxAppVersion ? `<= ${announcement.maxAppVersion}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      [
        `${announcement.id} ${announcement.severity.toLowerCase()} (${audience})`,
        `  shown ${announcement.startsAt.toISOString()} to ${announcement.endsAt.toISOString()}`,
        announcement.downtimeStartsAt && announcement.downtimeEndsAt
          ? `  downtime ${announcement.downtimeStartsAt.toISOString()} to ${announcement.downtimeEndsAt.toISOString()}`
          : null,
        `  ${announcement.message}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
} else {
  const ended = await prisma.announcement.updateMany({
    where: { id: parsed.id, endsAt: { gt: now } },
    data: { endsAt: now },
  });
  if (ended.count === 0) {
    console.error(`No current or upcoming announcement has the id ${parsed.id}.`);
    process.exitCode = 1;
  } else {
    console.log(`Ended announcement ${parsed.id}. Apps stop showing it within 30 seconds.`);
  }
}

await prisma.$disconnect();
