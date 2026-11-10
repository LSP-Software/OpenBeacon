import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
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
import { authRouter } from "../authRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";

const prefix = `tracking-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const epochId = `${prefix}-epoch`;
const ownerId = `${prefix}-owner`;
const memberId = `${prefix}-member`;
const outsiderId = `${prefix}-outsider`;
const ownerDeviceId = `${prefix}-owner-device`;
const deviceKey = createDeviceKeyPair();
const epochKey = generateGroupEpochKey();
const cache = new OpenBeaconCache({
  redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
  keyPrefix: `test-${crypto.randomUUID()}`,
  now: () => 0,
});
const router = createTRPCRouter({ auth: authRouter, groupTracking: groupTrackingRouter });
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
            { userId: ownerId, role: "OWNER", joinedEpochNumber: 1 },
            { userId: memberId, role: "MEMBER", joinedEpochNumber: 1 },
          ],
        },
      },
    });
    await prisma.groupEpoch.create({
      data: {
        id: epochId,
        groupId,
        epochNumber: 1,
        createdByDeviceId: ownerDeviceId,
        senderPublicKey: deviceKey.publicKey,
      },
    });
  });

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { id: groupId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId, outsiderId] } } });
    await prisma.$disconnect();
  });

  test("device registration cannot cross an account change", async () => {
    const otherDeviceId = `${prefix}-registration-race`;
    const key = createDeviceKeyPair();
    const input = {
      algorithm: key.algorithm,
      deviceId: otherDeviceId,
      publicKey: key.publicKey,
      expectedUserId: ownerId,
    };
    await expect(caller(memberId).auth.registerDeviceKey(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await prisma.userDevice.findUnique({ where: { id: otherDeviceId } })).toBeNull();
    await expect(
      caller(ownerId).auth.registerDeviceKey({
        ...input,
        publicKey: `${key.publicKey.slice(0, 4)}${" ".repeat(1_000_000)}${key.publicKey.slice(4)}`,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.userDevice.findUnique({ where: { id: otherDeviceId } })).toBeNull();
    await caller(ownerId).auth.registerDeviceKey(input);
    expect(
      (await prisma.userDevice.findUniqueOrThrow({ where: { id: otherDeviceId } })).userId,
    ).toBe(ownerId);
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
    expect(
      Buffer.from(stored[0]!.ciphertext, "base64").includes(Buffer.from(JSON.stringify(payload))),
    ).toBe(false);
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
      { ...point, clientPointId: "x".repeat(200_000) },
    ]) {
      await expect(
        caller(ownerId).groupTracking.uploadBatch({
          groupId,
          points: [input],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await prisma.groupEncryptedPayload.count({ where: { groupId } })).toBe(1);
  });
});
