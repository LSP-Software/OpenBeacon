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
import { DevicePendingError } from "../../lib/deviceActivation.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { authRouter } from "../authRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";

const prefix = `tracking-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const epochId = `${prefix}-epoch`;
const ownerId = `${prefix}-owner`;
const memberId = `${prefix}-member`;
const outsiderId = `${prefix}-outsider`;
const ownerDeviceId = `${prefix}-owner-device`;
const memberDeviceId = `${prefix}-member-device`;
const outsiderDeviceId = `${prefix}-outsider-device`;
const deviceKey = createDeviceKeyPair();
const epochKey = generateGroupEpochKey();
const cache = createIntegrationTestCache(() => 0);
const router = createTRPCRouter({
  auth: authRouter,
  groupMembership: groupMembershipRouter,
  groupTracking: groupTrackingRouter,
});
const caller = (userId: string, deviceId: string | null = null) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId,
      session: { user: { id: userId }, session: { id: `${userId}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );

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
        activatedAt: new Date(),
      },
    });
    await prisma.userDevice.createMany({
      data: [
        { id: memberDeviceId, userId: memberId },
        { id: outsiderDeviceId, userId: outsiderId },
      ].map((device) => ({
        ...device,
        publicKey: createDeviceKeyPair().publicKey,
        publicKeyAlgorithm: "X25519",
        name: "Phone",
        icon: "phone" as const,
        activatedAt: new Date(),
      })),
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
    const accepted = await caller(ownerId, ownerDeviceId).groupTracking.uploadBatch({
      groupId,
      points: [point],
    });
    expect(accepted.accepted).toEqual([point.clientPointId]);
    expect(
      (await prisma.userDevice.findUniqueOrThrow({ where: { id: ownerDeviceId } })).lastLocationAt,
    ).toBeInstanceOf(Date);
    const duplicate = await caller(ownerId, ownerDeviceId).groupTracking.uploadBatch({
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
    const received = await caller(memberId, memberDeviceId).groupTracking.poll({ groupId });
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
      caller(memberId, memberDeviceId).groupTracking.uploadBatch({
        groupId,
        points: [{ ...point, clientPointId: `${prefix}-forged` }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(outsiderId, outsiderDeviceId).groupTracking.poll({ groupId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "You are not a member of this group" });
    for (const input of [
      { ...point, nonce: `${" ".repeat(1_000_000)}${point.nonce}` },
      { ...point, ciphertext: "x".repeat(4097) },
      { ...point, clientPointId: "x".repeat(200_000) },
    ]) {
      await expect(
        caller(ownerId, ownerDeviceId).groupTracking.uploadBatch({
          groupId,
          points: [input],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await prisma.groupEncryptedPayload.count({ where: { groupId } })).toBe(1);
  });

  test("upload responses carry a key state that changes when tracking keys need checking", async () => {
    const upload = async (clientPointId: string) =>
      (
        await caller(ownerId, ownerDeviceId).groupTracking.uploadBatch({
          groupId,
          points: [
            {
              ...encryptGroupPayload({
                epochId,
                epochKey,
                groupId,
                kind: TRACKING_POINT_KIND,
                payload: { latitude: 1, longitude: 2 },
                senderDeviceId: ownerDeviceId,
              }),
              clientPointId,
            },
          ],
        })
      ).keyState;
    const first = await upload(`${prefix}-state-1`);
    expect(await upload(`${prefix}-state-2`)).toBe(first);
    await prisma.userDevice.update({
      where: { id: ownerDeviceId },
      data: { sharingRevision: { increment: 1 } },
    });
    const afterSharing = await upload(`${prefix}-state-3`);
    expect(afterSharing).not.toBe(first);
    await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: true } });
    const afterRotation = await upload(`${prefix}-state-4`);
    expect(afterRotation).not.toBe(afterSharing);
    await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: false } });
    await prisma.userDevice.update({
      where: { id: ownerDeviceId },
      data: { sharingRevision: { decrement: 1 } },
    });
    expect(await upload(`${prefix}-state-5`)).toBe(first);
    const joined = await prisma.groupMember.create({
      data: { groupId, userId: outsiderId, role: "MEMBER", joinedEpochNumber: 1 },
    });
    const afterJoin = await upload(`${prefix}-state-6`);
    expect(afterJoin).not.toBe(first);
    await prisma.groupMember.delete({ where: { id: joined.id } });
    expect(await upload(`${prefix}-state-7`)).toBe(first);
    const newEpochId = `${prefix}-state-epoch`;
    await prisma.groupEpoch.create({
      data: {
        id: newEpochId,
        groupId,
        epochNumber: 2,
        createdByDeviceId: ownerDeviceId,
        senderPublicKey: deviceKey.publicKey,
      },
    });
    const afterEpoch = await upload(`${prefix}-state-8`);
    expect(afterEpoch).not.toBe(first);
    expect(afterEpoch).not.toBe(afterJoin);
    await prisma.groupEpoch.delete({ where: { id: newEpochId } });
    expect(await upload(`${prefix}-state-9`)).toBe(first);
    await prisma.groupEncryptedPayload.deleteMany({
      where: { clientPointId: { startsWith: `${prefix}-state-` } },
    });
  }, 30_000);

  test("reports points for a deleted epoch as expired but rejects another group's epoch", async () => {
    const encrypt = (forEpochId: string, clientPointId: string) => ({
      ...encryptGroupPayload({
        epochId: forEpochId,
        epochKey,
        groupId,
        kind: TRACKING_POINT_KIND,
        payload: { latitude: 1, longitude: 2 },
        senderDeviceId: ownerDeviceId,
      }),
      clientPointId,
    });
    const result = await caller(ownerId, ownerDeviceId).groupTracking.uploadBatch({
      groupId,
      points: [
        encrypt(`${prefix}-deleted-epoch`, `${prefix}-expired`),
        encrypt(epochId, `${prefix}-current`),
      ],
    });
    expect(result).toEqual({
      accepted: [`${prefix}-current`],
      discarded: [],
      duplicates: [],
      expired: [`${prefix}-expired`],
      keyState: expect.any(String),
    });
    const otherGroupId = `${prefix}-other-group`;
    await prisma.group.create({
      data: {
        id: otherGroupId,
        name: "Other",
        groupEpochs: {
          create: {
            id: `${prefix}-other-epoch`,
            epochNumber: 1,
            createdByDeviceId: ownerDeviceId,
            senderPublicKey: deviceKey.publicKey,
          },
        },
      },
    });
    await expect(
      caller(ownerId, ownerDeviceId).groupTracking.uploadBatch({
        groupId,
        points: [encrypt(`${prefix}-other-epoch`, `${prefix}-foreign`)],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Epoch does not belong to this group.",
    });
    await prisma.group.delete({ where: { id: otherGroupId } });
    expect(
      await prisma.groupEncryptedPayload.count({
        where: { clientPointId: { in: [`${prefix}-expired`, `${prefix}-foreign`] } },
      }),
    ).toBe(0);
  });

  test("getLatest returns each active device's newest point and skips devices with none", async () => {
    const ownerTabletId = `${prefix}-owner-tablet`;
    const ownerRemovedId = `${prefix}-owner-removed`;
    const ownerSilentId = `${prefix}-owner-silent`;
    const ownerPendingId = `${prefix}-owner-pending`;
    await prisma.userDevice.createMany({
      data: [
        {
          id: ownerTabletId,
          userId: ownerId,
          name: "Tablet",
          icon: "tablet" as const,
          platform: "android",
        },
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
        activatedAt: new Date(),
        publicKey: createDeviceKeyPair().publicKey,
        publicKeyAlgorithm: "X25519",
      })),
    });
    await prisma.userDevice.create({
      data: {
        id: ownerPendingId,
        userId: ownerId,
        name: "New phone",
        icon: "phone",
        publicKey: createDeviceKeyPair().publicKey,
        publicKeyAlgorithm: "X25519",
      },
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
      (await caller(memberId, memberDeviceId).groupTracking.getLatest({ groupId })).points.map(
        (point) => [point.senderUserId, point.senderDeviceId, point.id],
      );

    await storePoint(`${prefix}-owner-old`, ownerId, ownerDeviceId, "2030-01-01T10:00:00.000Z");
    await storePoint(`${prefix}-owner-tie-a`, ownerId, ownerDeviceId, "2030-01-01T12:00:00.000Z");
    await storePoint(`${prefix}-owner-tie-b`, ownerId, ownerDeviceId, "2030-01-01T12:00:00.000Z");
    expect(await latest()).toEqual([[ownerId, ownerDeviceId, `${prefix}-owner-tie-b`]]);

    await storePoint(`${prefix}-tablet-old`, ownerId, ownerTabletId, "2030-01-01T08:00:00.000Z");
    await storePoint(`${prefix}-removed-new`, ownerId, ownerRemovedId, "2030-01-01T13:00:00.000Z");
    await storePoint(`${prefix}-pending-new`, ownerId, ownerPendingId, "2030-01-01T14:00:00.000Z");
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

    const pending = caller(ownerId, ownerPendingId).groupTracking;
    const devicePending = { code: "FORBIDDEN", cause: expect.any(DevicePendingError) };
    await expect(pending.getLatest({ groupId })).rejects.toMatchObject(devicePending);
    await expect(pending.poll({ groupId })).rejects.toMatchObject(devicePending);
    await expect(
      pending.uploadBatch({
        groupId,
        points: [
          {
            ...encryptGroupPayload({
              epochId,
              epochKey,
              groupId,
              kind: TRACKING_POINT_KIND,
              payload: { latitude: 1, longitude: 1 },
              senderDeviceId: ownerPendingId,
            }),
            clientPointId: `${prefix}-pending-upload`,
          },
        ],
      }),
    ).rejects.toMatchObject(devicePending);
    expect(
      await prisma.groupEncryptedPayload.count({
        where: { clientPointId: `${prefix}-pending-upload` },
      }),
    ).toBe(0);

    const devices = await caller(memberId, memberDeviceId).groupMembership.listMemberDevices({
      groupId,
    });
    expect(
      devices
        .filter((device) => device.deviceId.startsWith(prefix))
        .map((device) => device.deviceId)
        .sort(),
    ).toEqual([ownerDeviceId, ownerTabletId, ownerSilentId, memberDeviceId].sort());
    expect(devices.find((device) => device.deviceId === ownerTabletId)).toEqual({
      deviceId: ownerTabletId,
      userId: ownerId,
      name: "Tablet",
      icon: "tablet",
      platform: "android",
    });
    expect(devices.find((device) => device.deviceId === ownerSilentId)?.platform).toBeNull();
    await expect(
      caller(outsiderId, outsiderDeviceId).groupMembership.listMemberDevices({ groupId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "You are not a member of this group" });
  });
});
