import type { PrismaClient } from 'database';

export const isGuildPremium = async (guildId: string, db: PrismaClient): Promise<boolean> => {
  const guild = await db.guildSubscription.findFirst({
    where: {
      guildId,
      stripeStatus: {
        in: ['active', 'trialing'],
      },
    },
  });
  if (!guild || guild.id !== guildId) return false;
  return true;
};
