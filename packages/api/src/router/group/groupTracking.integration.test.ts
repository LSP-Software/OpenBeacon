import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
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
import { groupMembershipRouter } from "./groupMembershipRouter.ts";
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
const cache = createIntegrationTestCache(() => 0);
const router = createTRPCRouter({
  auth: authRouter,
  groupMembership: groupMembershipRouter,
  groupTracking: groupTrackingRouter,
});
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
        name: "Phone",
        icon: "phone",
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
    expect(
      (await prisma.userDevice.findUniqueOrThrow({ where: { id: ownerDeviceId } })).lastLocationAt,
    ).toBeInstanceOf(Date);
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

  test("getLatest returns each device's newest point and skips devices with none", async () => {
    const memberDeviceId = `${prefix}-member-device`;
    const ownerTabletId = `${prefix}-owner-tablet`;
    const ownerRemovedId = `${prefix}-owner-removed`;
    const ownerSilentId = `${prefix}-owner-silent`;
    await prisma.userDevice.createMany({
      data: [
        { id: memberDeviceId, userId: memberId, name: "Phone", icon: "phone" as const },
        { id: ownerTabletId, userId: ownerId, name: "Tablet", icon: "tablet" as const },
        {
          id: ownerRemovedId,
          userId: ownerId,
          name: "Old phone",
          icon: "phone" as const,
          revokedAt: new Date(),
        },
        { id: ownerSilentId, userId: ownerId, name: "Watch", icon: "watch" as const },
      ].map((device) => ({
        ...device,
        publicKey: createDeviceKeyPair().publicKey,
        publicKeyAlgorithm: "X25519",
      })),
    });
    const storePoint = (id: string, senderUserId: string, senderDeviceId: string, at: string) =>
      prisma.groupEncryptedPayload.create({
        data: {
          id,
          groupId,
          epochId,
          senderDeviceId,
          senderUserId,
          kind: TRACKING_POINT_KIND,
          algorithm: "XChaCha20-Poly1305",
          nonce: "nonce",
          ciphertext: "ciphertext",
          clientPointId: id,
          createdAt: new Date(at),
        },
      });
    const latest = async () =>
      (await caller(memberId).groupTracking.getLatest({ groupId })).points.map((point) => [
        point.senderUserId,
        point.senderDeviceId,
        point.id,
      ]);

    await storePoint(`${prefix}-owner-old`, ownerId, ownerDeviceId, "2030-01-01T10:00:00.000Z");
    await storePoint(`${prefix}-owner-tie-a`, ownerId, ownerDeviceId, "2030-01-01T12:00:00.000Z");
    await storePoint(`${prefix}-owner-tie-b`, ownerId, ownerDeviceId, "2030-01-01T12:00:00.000Z");
    expect(await latest()).toEqual([[ownerId, ownerDeviceId, `${prefix}-owner-tie-b`]]);

    await storePoint(`${prefix}-tablet-old`, ownerId, ownerTabletId, "2030-01-01T08:00:00.000Z");
    await storePoint(`${prefix}-removed-new`, ownerId, ownerRemovedId, "2030-01-01T13:00:00.000Z");
    await storePoint(`${prefix}-member-new`, memberId, memberDeviceId, "2030-01-01T11:00:00.000Z");
    await storePoint(`${prefix}-member-old`, memberId, memberDeviceId, "2030-01-01T09:00:00.000Z");
    expect(
      (await latest()).sort((first, second) => first.join().localeCompare(second.join())),
    ).toEqual(
      [
        [memberId, memberDeviceId, `${prefix}-member-new`],
        [ownerId, ownerDeviceId, `${prefix}-owner-tie-b`],
        [ownerId, ownerTabletId, `${prefix}-tablet-old`],
      ].sort((first, second) => first.join().localeCompare(second.join())),
    );

    const devices = await caller(memberId).groupMembership.listMemberDevices({ groupId });
    expect(
      devices
        .filter((device) => device.deviceId.startsWith(prefix))
        .map((device) => device.deviceId)
        .sort(),
    ).toEqual(
      [
        ownerDeviceId,
        ownerTabletId,
        ownerSilentId,
        memberDeviceId,
        `${prefix}-registration-race`,
      ].sort(),
    );
    expect(devices.find((device) => device.deviceId === ownerTabletId)).toEqual({
      deviceId: ownerTabletId,
      userId: ownerId,
      name: "Tablet",
      icon: "tablet",
    });
    await expect(
      caller(outsiderId).groupMembership.listMemberDevices({ groupId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
