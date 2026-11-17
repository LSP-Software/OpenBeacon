import type { SecurityAlerts } from "@openbeacon/auth";
import { type NotificationType, Prisma, type PrismaClient } from "@openbeacon/database";
import type { TurnedOffNotification } from "@openbeacon/email";
import { effectiveNotificationSetting, notificationTypes } from "@openbeacon/schemas";

export const readNotificationSettings = async (
  db: Pick<Prisma.TransactionClient, "notificationSetting">,
  userId: string,
) => {
  const stored = await db.notificationSetting.findMany({
    where: { userId },
    select: { type: true, email: true, phone: true },
  });
  return (Object.keys(notificationTypes) as NotificationType[]).map((type) => ({
    type,
    ...effectiveNotificationSetting(
      type,
      stored.find((setting) => setting.type === type),
    ),
  }));
};

export const changeNotificationSettings = async ({
  db,
  securityAlerts,
  userId,
  changes,
}: {
  db: PrismaClient;
  securityAlerts: SecurityAlerts | null;
  userId: string;
  changes: (TurnedOffNotification & { enabled: boolean })[];
}) => {
  const { settings, turnedOff } = await db.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`);
    const before = await readNotificationSettings(tx, userId);
    const turnedOff: TurnedOffNotification[] = [];
    for (const { type, channel, enabled } of changes) {
      const current = before.find((setting) => setting.type === type);
      if (!current || current[channel] === null || current[channel] === enabled) continue;
      const next = { email: current.email ?? false, phone: current.phone, [channel]: enabled };
      await tx.notificationSetting.upsert({
        where: { userId_type: { userId, type } },
        create: { userId, type, ...next },
        update: { [channel]: enabled },
      });
      if (!enabled && notificationTypes[type].section === "security") {
        turnedOff.push({ type, channel });
      }
    }
    return { settings: await readNotificationSettings(tx, userId), turnedOff };
  });
  if (turnedOff.length) securityAlerts?.turnedOff(userId, turnedOff);
  return settings;
};
