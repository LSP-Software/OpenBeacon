import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  decodeJsonPayload,
  decryptGroupPayload,
  encryptGroupPayload,
  generateGroupEpochKey,
} from "@openbeacon/encryption";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const prefix = `tracking-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const epochId = `${prefix}-epoch`;
const ownerId = `${prefix}-owner`;
const memberId = `${prefix}-member`;
const outsiderId = `${prefix}-outsider`;
const ownerDeviceId = `${prefix}-owner-device`;
const deviceKey = createDeviceKeyPair();
const epochKey = generateGroupEpochKey();
const cache = new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 });
const router = createTRPCRouter({ groupTracking: groupTrackingRouter });
const caller = (userId: string) =>
  router.createCaller({
    cache,
    db: prisma,
    clientIp: "127.0.0.1",
    session: { user: { id: userId } },
  } as Parameters<typeof router.createCaller>[0]);

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("tracking with PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [ownerId, memberId, outsiderId].map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
      })),
    });
    await prisma.userDevice.create({
      data: {
        id: ownerDeviceId,
        userId: ownerId,
        publicKey: deviceKey.publicKey,
        publicKeyAlgorithm: "X25519",
      },
    });
    await prisma.group.create({
      data: {
        id: groupId,
        name: "Tracking test",
        groupMembers: {
          create: [
            { userId: ownerId, role: "OWNER" },
            { userId: memberId, role: "MEMBER" },
          ],
        },
      },
    });
    await prisma.groupEpoch.create({
      data: { id: epochId, groupId, epochNumber: 1, createdByDeviceId: ownerDeviceId },
    });
  });

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { id: groupId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId, outsiderId] } } });
    await prisma.$disconnect();
  });

  test("stores opaque ciphertext once, authorizes the sender and rejects oversized input", async () => {
    const payload = { latitude: 51.5074, longitude: -0.1278, marker: "privacy-test-plaintext" };
    const encrypt = () =>
      encryptGroupPayload({
        epochId,
        epochKey,
        groupId,
        kind: TRACKING_POINT_KIND,
        payload,
        senderDeviceId: ownerDeviceId,
      });
    const point = { ...encrypt(), clientPointId: `${prefix}-point` };
    const accepted = await caller(ownerId).groupTracking.uploadBatch({ groupId, points: [point] });
    expect(accepted.accepted).toEqual([point.clientPointId]);
    const duplicate = await caller(ownerId).groupTracking.uploadBatch({
      groupId,
      points: [{ ...encrypt(), clientPointId: point.clientPointId }],
    });
    expect(duplicate.duplicates).toEqual([point.clientPointId]);
    const stored = await prisma.groupEncryptedPayload.findMany({ where: { groupId } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.ciphertext).toBe(point.ciphertext);
    expect(JSON.stringify(stored[0])).not.toContain(payload.marker);
    expect(JSON.stringify(stored[0])).not.toContain(String(payload.latitude));
    const received = await caller(memberId).groupTracking.poll({ groupId });
    expect(received.points).toHaveLength(1);
    expect(received.points[0]!.ciphertext).toBe(stored[0]!.ciphertext);
    expect(
      decodeJsonPayload(
        decryptGroupPayload({
          epochKey,
          encryptedPayload: {
            ...point,
            ciphertext: received.points[0]!.ciphertext,
            nonce: received.points[0]!.nonce,
          },
          expectedMetadata: {
            groupId,
            epochId,
            kind: TRACKING_POINT_KIND,
            senderDeviceId: ownerDeviceId,
          },
        }).bytes,
      ),
    ).toEqual(payload);
    await expect(
      caller(memberId).groupTracking.uploadBatch({
        groupId,
        points: [{ ...point, clientPointId: `${prefix}-forged` }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(outsiderId).groupTracking.poll({ groupId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    for (const input of [
      { ...point, nonce: `${" ".repeat(1_000_000)}${point.nonce}` },
      { ...point, ciphertext: "x".repeat(4097) },
    ]) {
      await expect(
        caller(ownerId).groupTracking.uploadBatch({
          groupId,
          points: [{ ...input, clientPointId: `${prefix}-oversized` }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await prisma.groupEncryptedPayload.count({ where: { groupId } })).toBe(1);
  });
});
