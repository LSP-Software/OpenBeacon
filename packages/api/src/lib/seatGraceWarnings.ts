import { AccountNoticeType, Prisma, type PrismaClient } from "@openbeacon/database";
import { errorCode, tryCatch } from "@openbeacon/shared";
import { limits } from "./limits.ts";
import {
  earnedGrace,
  lockAccounts,
  seatAccountSelect,
  seatPeriod,
  seatsEndingHolds,
} from "./seats.ts";

const dayMs = 86_400_000;
const pageSize = 500;

export const changePaidPeriod = ({
  db,
  now,
  paidPeriodEndsAt,
  userId,
}: {
  db: PrismaClient;
  now: Date;
  paidPeriodEndsAt: Date | null;
  userId: string;
}) =>
  db.$transaction(async (tx) => {
    await lockAccounts(tx, [userId]);
    const account = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: seatAccountSelect,
    });
    const grace = earnedGrace(account);
    const changed = await tx.user.update({
      where: { id: userId },
      data: {
        paidPeriodEndsAt,
        ...(grace && grace.startedAt <= now ? { lastGracePeriodStartedAt: grace.startedAt } : {}),
      },
      select: seatAccountSelect,
    });
    const holdsFrom = seatPeriod(changed, now).grace?.endsAt;
    await tx.accountNotice.deleteMany({
      where: {
        holdsFrom: { gt: now, ...(holdsFrom ? { not: holdsFrom } : {}) },
        OR: [
          {
            userId,
            type: { in: [AccountNoticeType.SEATS_ENDING, AccountNoticeType.SEATS_ENDING_SOON] },
          },
          { type: AccountNoticeType.SEAT_HOLD_COMING, group: { ownerId: userId } },
        ],
      },
    });
    return changed;
  });

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
        kind: "ending" | "reminder" | "ended";
        timezone: string | null;
      }) => Promise<unknown>)
    | null;
}) => {
  const at = (offsetMs: number) =>
    Prisma.sql`(${new Date(now.getTime() + offsetMs).toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  await eachAccount(
    db,
    Prisma.sql`
      "user"."paidPeriodEndsAt" <= ${at(0)}
      AND "user"."paidPeriodEndsAt" > ${at(-limits.gracePeriodDays * dayMs)}`,
    (userId) => warnAccount({ db, now, userId }),
  );
  await eachAccount(
    db,
    Prisma.sql`
      "user"."paidPeriodEndsAt" <= ${at(0)}
      AND "user"."seatsEndedNoticeFor" IS DISTINCT FROM "user"."paidPeriodEndsAt"`,
    (userId) => noticeSeatsEnded({ db, now, userId }),
  );
  if (sendEmail) await sendPendingEmails({ db, now, sendEmail });
};

const eachAccount = async (
  db: PrismaClient,
  where: Prisma.Sql,
  run: (userId: string) => Promise<void>,
) => {
  let after: { paidPeriodEndsAt: Date; id: string } | null = null;
  for (;;) {
    const page: Array<{ id: string; paidPeriodEndsAt: Date }> = await db.$queryRaw(Prisma.sql`
      SELECT "user"."id", "user"."paidPeriodEndsAt"
      FROM "User" AS "user"
      WHERE ${where}
        ${after ? Prisma.sql`AND ("user"."paidPeriodEndsAt", "user"."id") > ((${after.paidPeriodEndsAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'), ${after.id})` : Prisma.empty}
      ORDER BY "user"."paidPeriodEndsAt", "user"."id"
      LIMIT ${pageSize}
    `);
    for (const { id } of page) {
      const result = await tryCatch(run(id));
      if (!result.error) continue;
      const code = errorCode(result.error);
      console.error(`Seat grace check failed for an account${code ? ` (${code})` : ""}`);
    }
    const last = page.at(-1);
    if (!last || page.length < pageSize) return;
    after = last;
  }
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
  const account = await db.user.findUnique({ where: { id: userId }, select: seatAccountSelect });
  if (!account) return;
  const { grace } = seatPeriod(account, now);
  if (!grace) return;
  const firstWarning = account.lastGracePeriodStartedAt?.getTime() !== grace.startedAt.getTime();
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
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { paidPeriodEndsAt: true },
      });
      if (current?.paidPeriodEndsAt?.getTime() !== grace.startedAt.getTime()) return;
    }
    if (holds.length === 0) return;
    const reminderDue =
      !firstWarning &&
      now.getTime() >= grace.endsAt.getTime() - dayMs &&
      (await tx.accountNotice.count({
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
      })) === 0;
    const atRisk = holds.filter((hold) => hold.userId !== userId);
    const told = firstWarning
      ? []
      : await tx.accountNotice.findMany({
          where: {
            type: AccountNoticeType.SEAT_HOLD_COMING,
            holdsFrom: grace.endsAt,
            userId: { in: atRisk.map((hold) => hold.userId) },
            groupId: { in: atRisk.map((hold) => hold.groupId) },
          },
          select: { userId: true, groupId: true },
        });
    const members = [
      ...new Map(
        atRisk
          .filter(
            (hold) =>
              !told.some(
                (notice) => notice.userId === hold.userId && notice.groupId === hold.groupId,
              ),
          )
          .map((hold) => [
            `${hold.userId}\u0000${hold.groupId}`,
            { userId: hold.userId, groupId: hold.groupId },
          ]),
      ).values(),
    ];
    const ownerNotice = firstWarning
      ? AccountNoticeType.SEATS_ENDING
      : reminderDue
        ? AccountNoticeType.SEATS_ENDING_SOON
        : null;
    const data = [
      ...(ownerNotice ? [{ userId, type: ownerNotice, holdsFrom: grace.endsAt }] : []),
      ...members.map((member) => ({
        userId: member.userId,
        groupId: member.groupId,
        type: AccountNoticeType.SEAT_HOLD_COMING,
        holdsFrom: grace.endsAt,
      })),
    ];
    if (data.length > 0) await tx.accountNotice.createMany({ data });
  });
};

const endedHolds = ({
  db,
  holdsFrom,
  ownerId,
}: {
  db: PrismaClient;
  holdsFrom: Date;
  ownerId: string;
}) => seatsEndingHolds({ db, now: new Date(holdsFrom.getTime() - 1), ownerId });

const noticeSeatsEnded = async ({
  db,
  now,
  userId,
}: {
  db: PrismaClient;
  now: Date;
  userId: string;
}) => {
  const account = await db.user.findUnique({ where: { id: userId }, select: seatAccountSelect });
  const endedAt = account?.paidPeriodEndsAt;
  if (!account || !endedAt || seatPeriod(account, now).seats > 0) return;
  const grace = earnedGrace(account);
  const warned =
    grace !== null && account.lastGracePeriodStartedAt?.getTime() === endedAt.getTime();
  const holdsFrom = grace?.endsAt ?? endedAt;
  const holds = warned ? [] : await endedHolds({ db, holdsFrom, ownerId: userId });
  await db.$transaction(async (tx) => {
    const stamped = await tx.user.updateMany({
      where: {
        id: userId,
        paidPeriodEndsAt: endedAt,
        lastGracePeriodStartedAt: account.lastGracePeriodStartedAt,
        OR: [{ seatsEndedNoticeFor: null }, { seatsEndedNoticeFor: { not: endedAt } }],
      },
      data: {
        seatsEndedNoticeFor: endedAt,
        ...(grace ? { lastGracePeriodStartedAt: endedAt } : {}),
      },
    });
    if (stamped.count === 0 || holds.length === 0) return;
    await tx.accountNotice.create({
      data: { userId, type: AccountNoticeType.SEATS_ENDED, holdsFrom },
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
      emailedAt: null,
      OR: [
        {
          type: { in: [AccountNoticeType.SEATS_ENDING, AccountNoticeType.SEATS_ENDING_SOON] },
          holdsFrom: { gt: now },
        },
        { type: AccountNoticeType.SEATS_ENDED },
      ],
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
    const ended = notice.type === AccountNoticeType.SEATS_ENDED;
    const period = seatPeriod(notice.user, now);
    const holdsFrom = ended
      ? (earnedGrace(notice.user)?.endsAt ?? notice.user.paidPeriodEndsAt)
      : (period.grace?.endsAt ?? null);
    if (
      !holdsFrom ||
      holdsFrom.getTime() !== notice.holdsFrom?.getTime() ||
      (ended && period.seats > 0)
    ) {
      continue;
    }
    const holds = ended
      ? await endedHolds({ db, holdsFrom, ownerId: notice.user.id })
      : await seatsEndingHolds({ db, now, ownerId: notice.user.id });
    if (holds.length === 0) continue;
    const sent = await tryCatch(
      sendEmail({
        to: notice.user.email,
        userId: notice.user.id,
        holds,
        holdsFrom,
        kind: ended
          ? "ended"
          : notice.type === AccountNoticeType.SEATS_ENDING_SOON
            ? "reminder"
            : "ending",
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
