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
        { name: "oldRemoved", createdAt: ago(30), activatedAt: null, revokedAt: ago(1) },
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
      data: ["oldPending", "newPending"].map((name) => ({
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
        { name: "recentlyLinked", expiresAt: ago(2), completedAt: ago(2) },
        { name: "longAgoLinked", expiresAt: ago(9), completedAt: ago(9) },
      ].map(({ expiresAt, name, ...link }) => ({
        ...link,
        deviceId: `${prefix}-${name}`,
        expiresAt,
        id: `${prefix}-${name}-link`,
        userId,
      })),
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test("deletes Pending devices older than 7 days and signs them out", async () => {
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
      "oldRemoved",
      "recentlyLinked",
    ]);
    const sessions = await prisma.session.findMany({ where: { userId }, select: { id: true } });
    expect(sessions.map(({ id }) => id)).toEqual([`${prefix}-newPending-session`]);
  });

  test("deletes open links a day after they expire and completed ones after 7 days", async () => {
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
});
