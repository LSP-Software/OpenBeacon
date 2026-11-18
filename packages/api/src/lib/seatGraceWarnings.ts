import { AccountNoticeType, Prisma, type PrismaClient } from "@openbeacon/database";
import { errorCode, tryCatch } from "@openbeacon/shared";
import { limits } from "./limits.ts";
import { lockAccounts, seatAccountSelect, seatPeriod, seatsEndingHolds } from "./seats.ts";

const dayMs = 86_400_000;
const pageSize = 500;

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
  const at = (offsetMs: number) =>
    Prisma.sql`(${new Date(now.getTime() + offsetMs).toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const graceMs = limits.gracePeriodDays * dayMs;
  let after: { paidPeriodEndsAt: Date; id: string } | null = null;
  for (;;) {
    const page: Array<{ id: string; paidPeriodEndsAt: Date }> = await db.$queryRaw(Prisma.sql`
      SELECT "user"."id", "user"."paidPeriodEndsAt"
      FROM "User" AS "user"
      WHERE "user"."paidPeriodEndsAt" <= ${at(0)}
        AND "user"."paidPeriodEndsAt" > ${at(-graceMs)}
        AND (
          "user"."lastGracePeriodStartedAt" IS NULL
          OR "user"."lastGracePeriodStartedAt" = "user"."paidPeriodEndsAt"
          OR "user"."lastGracePeriodStartedAt" <= "user"."paidPeriodEndsAt" - make_interval(months => ${limits.graceCooldownMonths}::int)
        )
        AND (
          "user"."lastGracePeriodStartedAt" IS DISTINCT FROM "user"."paidPeriodEndsAt"
          OR (
            "user"."paidPeriodEndsAt" <= ${at(dayMs - graceMs)}
            AND NOT EXISTS (
              SELECT 1 FROM "AccountNotice" AS "notice"
              WHERE "notice"."userId" = "user"."id"
                AND (
                  ("notice"."type" = 'SEATS_ENDING_SOON' AND "notice"."createdAt" >= "user"."paidPeriodEndsAt")
                  OR ("notice"."type" = 'SEATS_ENDING' AND "notice"."createdAt" > ${at(-dayMs)})
                )
            )
          )
        )
        ${after ? Prisma.sql`AND ("user"."paidPeriodEndsAt", "user"."id") > ((${after.paidPeriodEndsAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'), ${after.id})` : Prisma.empty}
      ORDER BY "user"."paidPeriodEndsAt", "user"."id"
      LIMIT ${pageSize}
    `);
    for (const { id } of page) await warnAccount({ db, now, userId: id });
    const last = page.at(-1);
    if (!last || page.length < pageSize) break;
    after = last;
  }
  if (sendEmail) await sendPendingEmails({ db, now, sendEmail });
};

const warnAccount = async ({
  db,
  now,
  userId,
}: {
  db: PrismaClient;
  now: Date;
  userId: string;
}) => {
  const account = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: seatAccountSelect,
  });
  const { grace } = seatPeriod(account, now);
  if (!grace) return;
  const firstWarning = account.lastGracePeriodStartedAt?.getTime() !== grace.startedAt.getTime();
  if (!firstWarning && now.getTime() < grace.endsAt.getTime() - dayMs) return;
  const holds = await seatsEndingHolds({ db, now, ownerId: userId });
  await db.$transaction(async (tx) => {
    if (firstWarning) {
      const stamped = await tx.user.updateMany({
        where: {
          id: userId,
          paidPeriodEndsAt: grace.startedAt,
          OR: [
            { lastGracePeriodStartedAt: null },
            { lastGracePeriodStartedAt: { not: grace.startedAt } },
          ],
        },
        data: { lastGracePeriodStartedAt: grace.startedAt },
      });
      if (stamped.count === 0) return;
    } else {
      await lockAccounts(tx, [userId]);
      const recent = await tx.accountNotice.count({
        where: {
          userId,
          OR: [
            { type: AccountNoticeType.SEATS_ENDING_SOON, createdAt: { gte: grace.startedAt } },
            {
              type: AccountNoticeType.SEATS_ENDING,
              createdAt: { gt: new Date(now.getTime() - dayMs) },
            },
          ],
        },
      });
      if (recent > 0) return;
    }
    if (holds.length === 0) return;
    const members = [
      ...new Map(
        holds
          .filter((hold) => hold.userId !== userId)
          .map((hold) => [
            `${hold.userId}\u0000${hold.groupId}`,
            { userId: hold.userId, groupId: hold.groupId },
          ]),
      ).values(),
    ];
    await tx.accountNotice.createMany({
      data: [
        {
          userId,
          type: firstWarning ? AccountNoticeType.SEATS_ENDING : AccountNoticeType.SEATS_ENDING_SOON,
          holdsFrom: grace.endsAt,
        },
        ...(firstWarning
          ? members.map((member) => ({
              userId: member.userId,
              groupId: member.groupId,
              type: AccountNoticeType.SEAT_HOLD_COMING,
              holdsFrom: grace.endsAt,
            }))
          : []),
      ],
    });
  });
};

const sendPendingEmails = async ({
  db,
  now,
  sendEmail,
}: {
  db: PrismaClient;
  now: Date;
  sendEmail: NonNullable<Parameters<typeof sendSeatGraceWarnings>[0]["sendEmail"]>;
}) => {
  const pending = await db.accountNotice.findMany({
    where: {
      type: { in: [AccountNoticeType.SEATS_ENDING, AccountNoticeType.SEATS_ENDING_SOON] },
      emailedAt: null,
      holdsFrom: { gt: now },
    },
    select: {
      id: true,
      type: true,
      holdsFrom: true,
      user: { select: { id: true, email: true, timezone: true, ...seatAccountSelect } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: pageSize,
  });
  for (const notice of pending) {
    const claimed = await db.accountNotice.updateMany({
      where: { id: notice.id, emailedAt: null },
      data: { emailedAt: now },
    });
    if (claimed.count === 0) continue;
    const { grace } = seatPeriod(notice.user, now);
    if (!grace || grace.endsAt.getTime() !== notice.holdsFrom?.getTime()) continue;
    const holds = await seatsEndingHolds({ db, now, ownerId: notice.user.id });
    if (holds.length === 0) continue;
    const sent = await tryCatch(
      sendEmail({
        to: notice.user.email,
        userId: notice.user.id,
        holds,
        holdsFrom: grace.endsAt,
        reminder: notice.type === AccountNoticeType.SEATS_ENDING_SOON,
        timezone: notice.user.timezone,
      }),
    );
    if (!sent.error) continue;
    const code = errorCode(sent.error);
    console.error(`Seats ending email failed${code ? ` (${code})` : ""}`);
    await db.accountNotice.updateMany({
      where: { id: notice.id },
      data: { emailedAt: null },
    });
  }
};
