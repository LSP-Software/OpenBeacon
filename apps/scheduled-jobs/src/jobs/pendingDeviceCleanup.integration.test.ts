import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@openbeacon/database";
import { runPendingDeviceCleanup } from "./pendingDeviceCleanup.ts";

const prefix = `pending-device-cleanup-${crypto.randomUUID()}`;
const userId = `${prefix}-user`;
const day = 24 * 60 * 60_000;

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("Pending device clean-up", () => {
  beforeAll(async () => {
    const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!clock) throw new Error("Unable to read database time.");
    const ago = (days: number) => new Date(clock.now.getTime() - days * day);
    await prisma.user.create({
      data: { id: userId, name: userId, email: `${userId}@example.test` },
    });
    await prisma.userDevice.createMany({
      data: [
        { name: "oldPending", createdAt: ago(8), activatedAt: null },
        { name: "newPending", createdAt: ago(6), activatedAt: null },
        { name: "oldActive", createdAt: ago(30), activatedAt: ago(30) },
        { name: "removedPending", createdAt: ago(9), activatedAt: null, revokedAt: ago(8) },
        { name: "recentlyRemovedPending", createdAt: ago(9), activatedAt: null, revokedAt: ago(6) },
        { name: "removedActive", createdAt: ago(30), activatedAt: ago(30), revokedAt: ago(20) },
        { name: "recentlyLinked", createdAt: ago(3), activatedAt: ago(2) },
        { name: "longAgoLinked", createdAt: ago(10), activatedAt: ago(9) },
      ].map((device) => ({
        ...device,
        id: `${prefix}-${device.name}`,
        icon: "phone" as const,
        publicKey: "public-key",
        publicKeyAlgorithm: "X25519",
        userId,
      })),
    });
    await prisma.session.createMany({
      data: ["oldPending", "newPending", "removedPending"].map((name) => ({
        id: `${prefix}-${name}-session`,
        token: `${prefix}-${name}-token`,
        userId,
        deviceId: `${prefix}-${name}`,
        expiresAt: new Date(clock.now.getTime() + day),
      })),
    });
    await prisma.deviceLink.createMany({
      data: [
        { name: "newPending", expiresAt: new Date(clock.now.getTime() - 2 * day) },
        { name: "oldActive", expiresAt: new Date(clock.now.getTime() - 60_000) },
        {
          name: "recentlyLinked",
          expiresAt: new Date(clock.now.getTime() - 60_000),
          completedAt: new Date(clock.now.getTime() - 60_000),
        },
        { name: "longAgoLinked", expiresAt: ago(2), completedAt: ago(2) },
      ].map(({ expiresAt, name, ...link }) => ({
        ...link,
        deviceId: `${prefix}-${name}`,
        expiresAt,
        id: `${prefix}-${name}-link`,
        userId,
      })),
    });
    await prisma.deviceChallenge.createMany({
      data: [
        { name: "expired", expiresAt: new Date(clock.now.getTime() - 60_000) },
        { name: "live", expiresAt: new Date(clock.now.getTime() + 60_000) },
      ].map(({ expiresAt, name }) => ({
        challengeHash: "hash",
        deviceId: `${prefix}-oldActive`,
        expiresAt,
        id: `${prefix}-${name}-challenge`,
        purpose: "activation" as const,
      })),
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test("deletes Pending devices older than 7 days and removed ones a week after removal", async () => {
    await runPendingDeviceCleanup();
    const devices = await prisma.userDevice.findMany({
      where: { userId },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    expect(devices.map(({ name }) => name)).toEqual([
      "longAgoLinked",
      "newPending",
      "oldActive",
      "recentlyLinked",
      "recentlyRemovedPending",
      "removedActive",
    ]);
    const sessions = await prisma.session.findMany({ where: { userId }, select: { id: true } });
    expect(sessions.map(({ id }) => id)).toEqual([`${prefix}-newPending-session`]);
  });

  test("deletes open and approved links a day after they expire", async () => {
    const links = await prisma.deviceLink.findMany({
      where: { userId },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    expect(links.map(({ id }) => id)).toEqual([
      `${prefix}-oldActive-link`,
      `${prefix}-recentlyLinked-link`,
    ]);
  });

  test("deletes expired device challenges and keeps live ones", async () => {
    const challenges = await prisma.deviceChallenge.findMany({
      where: { deviceId: `${prefix}-oldActive` },
      select: { id: true },
    });
    expect(challenges.map(({ id }) => id)).toEqual([`${prefix}-live-challenge`]);
  });
});
