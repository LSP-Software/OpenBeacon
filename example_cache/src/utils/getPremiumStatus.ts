import type { PrismaClient } from 'database';

export const getPremiumStatus = async (db: PrismaClient, guildId: string): Promise<boolean> => {
  try {
    const subscription = await db.guildSubscription.findFirst({
      where: {
        guildId,
        stripeStatus: {
          in: ['active', 'trialing'],
        },
      },
    });
    return Boolean(subscription);
  } catch (error) {
    console.warn('Failed to check premium status for guild:', guildId, error);
    return false;
  }
};
