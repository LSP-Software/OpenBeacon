import { AccountNoticeType, type PrismaClient } from "@openbeacon/database";
import { errorCode, tryCatch } from "@openbeacon/shared";
import { seatAccountSelect, seatPeriod, seatsEndingHolds } from "./seats.ts";

const dayMs = 86_400_000;

export const sendSeatGraceWarnings = async ({
  db,
  now,
  sendEmail,
}: {
  db: PrismaClient;
  now: Date;
  sendEmail:
    | ((email: {
        to: string;
        userId: string;
        holds: Awaited<ReturnType<typeof seatsEndingHolds>>;
        holdsFrom: Date;
        reminder: boolean;
        timezone: string | null;
      }) => Promise<unknown>)
    | null;
}) => {
  const accounts = await db.user.findMany({
    where: { paidPeriodEndsAt: { lte: now, gt: new Date(now.getTime() - 7 * dayMs) } },
    select: { id: true, email: true, timezone: true, ...seatAccountSelect },
    orderBy: { paidPeriodEndsAt: "asc" },
    take: 500,
  });
  for (const account of accounts) {
    const { grace, seats } = seatPeriod(account, now);
    if (!grace) continue;
    const firstWarning = account.lastGracePeriodStartedAt?.getTime() !== grace.startedAt.getTime();
    const reminderDue =
      !firstWarning &&
      now.getTime() >= grace.endsAt.getTime() - dayMs &&
      (await db.accountNotice.count({
        where: {
          userId: account.id,
          type: AccountNoticeType.SEATS_ENDING_SOON,
          createdAt: { gte: grace.startedAt },
        },
      })) === 0;
    if (!firstWarning && !reminderDue) continue;
    const holds = await seatsEndingHolds({ db, ownerId: account.id, seats });
    const claimed = await db.$transaction(async (tx) => {
      if (firstWarning) {
        const stamped = await tx.user.updateMany({
          where: {
            id: account.id,
            paidPeriodEndsAt: grace.startedAt,
            OR: [
              { lastGracePeriodStartedAt: null },
              { lastGracePeriodStartedAt: { not: grace.startedAt } },
            ],
          },
          data: { lastGracePeriodStartedAt: grace.startedAt },
        });
        if (stamped.count === 0) return false;
      }
      if (holds.length === 0) return false;
      const members = [
        ...new Map(
          holds
            .filter(({ userId }) => userId !== account.id)
            .map(({ userId, groupId }) => [`${userId}\u0000${groupId}`, { userId, groupId }]),
        ).values(),
      ];
      await tx.accountNotice.createMany({
        data: [
          {
            userId: account.id,
            type: firstWarning
              ? AccountNoticeType.SEATS_ENDING
              : AccountNoticeType.SEATS_ENDING_SOON,
            holdsFrom: grace.endsAt,
          },
          ...(firstWarning
            ? members.map(({ userId, groupId }) => ({
                userId,
                groupId,
                type: AccountNoticeType.SEAT_HOLD_COMING,
                holdsFrom: grace.endsAt,
              }))
            : []),
        ],
      });
      return true;
    });
    if (!claimed || !sendEmail) continue;
    const sent = await tryCatch(
      sendEmail({
        to: account.email,
        userId: account.id,
        holds,
        holdsFrom: grace.endsAt,
        reminder: !firstWarning,
        timezone: account.timezone,
      }),
    );
    if (sent.error) {
      const code = errorCode(sent.error);
      console.error(`Seats ending email failed${code ? ` (${code})` : ""}`);
    }
  }
};
