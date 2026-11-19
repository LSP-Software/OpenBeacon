import { AccountNoticeType, Prisma, type PrismaClient } from "@openbeacon/database";
import { errorCode, tryCatch } from "@openbeacon/shared";
import { seatsEndedHolds } from "./seats.ts";

const pageSize = 500;

export const sendSeatsEndedNotices = async ({
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
        holds: Awaited<ReturnType<typeof seatsEndedHolds>>;
        endedAt: Date;
        timezone: string | null;
      }) => Promise<unknown>)
    | null;
}) => {
  const nowSql = Prisma.sql`(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  let after: { paidPeriodEndsAt: Date; id: string } | null = null;
  for (;;) {
    const page: Array<{ id: string; paidPeriodEndsAt: Date }> = await db.$queryRaw(Prisma.sql`
      SELECT "user"."id", "user"."paidPeriodEndsAt"
      FROM "User" AS "user"
      WHERE "user"."paidPeriodEndsAt" <= ${nowSql}
        AND "user"."seatsEndedNoticeFor" IS DISTINCT FROM "user"."paidPeriodEndsAt"
        ${after ? Prisma.sql`AND ("user"."paidPeriodEndsAt", "user"."id") > ((${after.paidPeriodEndsAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'), ${after.id})` : Prisma.empty}
      ORDER BY "user"."paidPeriodEndsAt", "user"."id"
      LIMIT ${pageSize}
    `);
    for (const account of page) {
      const result = await tryCatch(
        noticeSeatsEnded({ db, endedAt: account.paidPeriodEndsAt, now, userId: account.id }),
      );
      if (!result.error) continue;
      const code = errorCode(result.error);
      console.error(`Seats ended check failed for an account${code ? ` (${code})` : ""}`);
    }
    const last = page.at(-1);
    if (!last || page.length < pageSize) break;
    after = last;
  }
  if (sendEmail) await sendPendingEmails({ db, now, sendEmail });
};

const noticeSeatsEnded = async ({
  db,
  endedAt,
  now,
  userId,
}: {
  db: PrismaClient;
  endedAt: Date;
  now: Date;
  userId: string;
}) => {
  const holds = await seatsEndedHolds({ db, endedAt, ownerId: userId });
  await db.$transaction(async (tx) => {
    const stamped = await tx.user.updateMany({
      where: {
        id: userId,
        paidPeriodEndsAt: endedAt,
        OR: [{ seatsEndedNoticeFor: null }, { seatsEndedNoticeFor: { not: endedAt } }],
      },
      data: { seatsEndedNoticeFor: endedAt },
    });
    if (stamped.count === 0 || holds.length === 0) return;
    await tx.accountNotice.updateMany({
      where: { userId, type: AccountNoticeType.SEATS_ENDED, emailedAt: null },
      data: { emailedAt: now },
    });
    await tx.accountNotice.create({ data: { userId, type: AccountNoticeType.SEATS_ENDED } });
  });
};

const sendPendingEmails = async ({
  db,
  now,
  sendEmail,
}: {
  db: PrismaClient;
  now: Date;
  sendEmail: NonNullable<Parameters<typeof sendSeatsEndedNotices>[0]["sendEmail"]>;
}) => {
  const pending = await db.accountNotice.findMany({
    where: { emailedAt: null, type: AccountNoticeType.SEATS_ENDED },
    select: {
      id: true,
      user: { select: { id: true, email: true, timezone: true, paidPeriodEndsAt: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: pageSize,
  });
  for (const notice of pending) {
    const claimed = await db.accountNotice.updateMany({
      where: { id: notice.id, emailedAt: null },
      data: { emailedAt: now },
    });
    const endedAt = notice.user.paidPeriodEndsAt;
    if (claimed.count === 0 || !endedAt || endedAt > now) continue;
    const holds = await seatsEndedHolds({ db, endedAt, ownerId: notice.user.id });
    if (holds.length === 0) continue;
    const sent = await tryCatch(
      sendEmail({
        to: notice.user.email,
        userId: notice.user.id,
        holds,
        endedAt,
        timezone: notice.user.timezone,
      }),
    );
    if (!sent.error) continue;
    const code = errorCode(sent.error);
    console.error(`Seats ended email failed${code ? ` (${code})` : ""}`);
    await db.accountNotice.updateMany({ where: { id: notice.id }, data: { emailedAt: null } });
  }
};
