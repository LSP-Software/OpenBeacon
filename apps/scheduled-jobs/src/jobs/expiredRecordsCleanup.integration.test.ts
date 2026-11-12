import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@openbeacon/database";
import { runExpiredRecordsCleanup } from "./expiredRecordsCleanup.ts";

const prefix = `expired-records-cleanup-${crypto.randomUUID()}`;
const memberId = `${prefix}-member`;
const leaverId = `${prefix}-leaver`;
const guestId = `${prefix}-guest`;
const groupId = `${prefix}-group`;
const day = 24 * 60 * 60_000;
const verificationRows = {
  expiredCode: { identifier: `email-code:sign-up:${prefix}@example.com`, expiresInMs: -60_000 },
  expiredToken: { identifier: `${prefix}-expired-token`, expiresInMs: -1_000 },
  expiredBetterAuth: { identifier: `${prefix}-better-auth`, expiresInMs: -3_600_000 },
  liveCode: { identifier: `email-code:password-reset:${prefix}@example.com`, expiresInMs: 600_000 },
  liveToken: { identifier: `${prefix}-live-token`, expiresInMs: 60_000 },
};

const ids = async (rows: Promise<Array<{ id: string }>>) =>
  (await rows).map(({ id }) => id.slice(prefix.length + 1)).sort();

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("Expired records clean-up", () => {
  beforeAll(async () => {
    const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!clock) throw new Error("Unable to read database time.");
    const at = (offsetMs: number) => new Date(clock.now.getTime() + offsetMs);
    await prisma.user.createMany({
      data: [memberId, leaverId, guestId].map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
      })),
    });
    await prisma.group.create({
      data: {
        id: groupId,
        name: "Group",
        groupMembers: { create: { userId: memberId, role: "OWNER", joinedEpochNumber: 1 } },
      },
    });
    await prisma.verification.createMany({
      data: Object.entries(verificationRows).map(([name, row]) => ({
        id: `${prefix}-${name}`,
        identifier: row.identifier,
        value: "hashed",
        expiresAt: at(row.expiresInMs),
      })),
    });
    await prisma.session.createMany({
      data: [
        { name: "expiredSession", expiresAt: at(-1_000) },
        { name: "longExpiredSession", expiresAt: at(-40 * day) },
        { name: "liveSession", expiresAt: at(60_000) },
      ].map(({ name, expiresAt }) => ({
        id: `${prefix}-${name}`,
        token: `${prefix}-${name}-token`,
        userId: memberId,
        expiresAt,
      })),
    });
    await prisma.googleDeletionChallenge.createMany({
      data: [
        { name: "expiredChallenge", expiresAt: at(-1_000) },
        { name: "liveChallenge", expiresAt: at(60_000) },
        { name: "expiredSessionChallenge", expiresAt: at(60_000), session: "expiredSession" },
      ].map(({ name, expiresAt, session = "liveSession" }) => ({
        id: `${prefix}-${name}`,
        userId: memberId,
        sessionId: `${prefix}-${session}`,
        nonce: "nonce",
        codeVerifier: "verifier",
        expiresAt,
      })),
    });
    await prisma.groupSharedInvite.createMany({
      data: [
        { name: "expiredInvite", expiresAt: at(-day - 60_000) },
        { name: "usedInvite", expiresAt: at(-day - 60_000), usedAt: at(-day - 120_000) },
        { name: "recentlyExpiredInvite", expiresAt: at(-day + 60_000) },
        { name: "recentlyUsedInvite", expiresAt: at(60_000), usedAt: at(-1_000) },
        { name: "liveInvite", expiresAt: at(60_000) },
      ].map(({ name, ...invite }) => ({
        ...invite,
        id: `${prefix}-${name}`,
        codeHash: `${prefix}-${name}`,
        creatorId: memberId,
        groupId,
      })),
    });
    await prisma.groupJoinAlert.createMany({
      data: [
        { name: "oldAlert", createdAt: at(-30 * day - 60_000) },
        { name: "monthOldAlert", createdAt: at(-30 * day + 60_000) },
        { name: "newAlert", createdAt: at(-1_000) },
        { name: "leftGroupAlert", createdAt: at(-1_000), recipientId: leaverId },
      ].map(({ name, recipientId = memberId, createdAt }) => ({
        id: `${prefix}-${name}`,
        recipientId,
        memberId: recipientId === memberId ? leaverId : memberId,
        groupId,
        memberName: "Joiner",
        createdAt,
      })),
    });
    await prisma.groupMemberInvite.createMany({
      data: [
        {
          name: "oldInvite",
          createdAt: at(-30 * day - 60_000),
          inviterId: memberId,
          recipientId: leaverId,
        },
        {
          name: "recentInvite",
          createdAt: at(-30 * day + 60_000),
          inviterId: memberId,
          recipientId: guestId,
        },
        {
          name: "leftInviterInvite",
          createdAt: at(-1_000),
          inviterId: leaverId,
          recipientId: memberId,
        },
      ].map(({ name, ...invite }) => ({
        ...invite,
        id: `${prefix}-${name}`,
        groupId,
        role: "MEMBER" as const,
      })),
    });
    await prisma.feedback.createMany({
      data: [
        { name: "oldFeedback", createdAt: at(-30 * day - 60_000) },
        { name: "newFeedback", createdAt: at(-30 * day + 60_000) },
      ].map(({ name, createdAt }) => ({ id: `${prefix}-${name}`, message: name, createdAt })),
    });
  });

  afterAll(async () => {
    await prisma.feedback.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.verification.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.group.deleteMany({ where: { id: groupId } });
    await prisma.user.deleteMany({ where: { id: { in: [memberId, leaverId, guestId] } } });
    await prisma.$disconnect();
  });

  test("deletes expired records and keeps live ones", async () => {
    await runExpiredRecordsCleanup();
    expect(
      await ids(prisma.verification.findMany({ where: { id: { startsWith: prefix } } })),
    ).toEqual(["liveCode", "liveToken"]);
    expect(await ids(prisma.session.findMany({ where: { userId: memberId } }))).toEqual([
      "liveSession",
    ]);
    expect(
      await ids(prisma.googleDeletionChallenge.findMany({ where: { userId: memberId } })),
    ).toEqual(["liveChallenge"]);
    expect(await ids(prisma.groupSharedInvite.findMany({ where: { groupId } }))).toEqual([
      "liveInvite",
      "recentlyExpiredInvite",
      "recentlyUsedInvite",
    ]);
    expect(await ids(prisma.groupJoinAlert.findMany({ where: { groupId } }))).toEqual([
      "monthOldAlert",
      "newAlert",
    ]);
    expect(await ids(prisma.groupMemberInvite.findMany({ where: { groupId } }))).toEqual([
      "recentInvite",
    ]);
    expect(await ids(prisma.feedback.findMany({ where: { id: { startsWith: prefix } } }))).toEqual([
      "newFeedback",
    ]);
  });

  test("is safe to run again", async () => {
    await runExpiredRecordsCleanup();
    expect(await ids(prisma.session.findMany({ where: { userId: memberId } }))).toEqual([
      "liveSession",
    ]);
    expect(await ids(prisma.groupJoinAlert.findMany({ where: { groupId } }))).toEqual([
      "monthOldAlert",
      "newAlert",
    ]);
  });
});
