import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
  encryptGroupPayload,
  unwrapEpochKey,
} from "@openbeacon/encryption";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import { deleteAccountRecords } from "../../lib/account-deletion.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupEpochRouter } from "./groupEpochRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";

const prefix = `rotation-${crypto.randomUUID()}`;
const userId = `${prefix}-user`;
const deviceId = `${prefix}-device`;
const groupId = `${prefix}-group`;
const key = createDeviceKeyPair();
const cache = new OpenBeaconCache({
  redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
  keyPrefix: `test-${crypto.randomUUID()}`,
  now: () => 0,
});
const router = createTRPCRouter({
  groupEpoch: groupEpochRouter,
  groupTracking: groupTrackingRouter,
});
const caller = router.createCaller({
  cache,
  db: prisma,
  clientIp: "127.0.0.1",
  session: { user: { id: userId } },
} as Parameters<typeof router.createCaller>[0]);

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "group rotation with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.create({
        data: { id: userId, name: "User", email: `${userId}@example.test` },
      });
      await prisma.userDevice.create({
        data: { id: deviceId, userId, publicKey: key.publicKey, publicKeyAlgorithm: "X25519" },
      });
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Group",
          epochRotationRequired: true,
          groupMembers: { create: { userId, role: "OWNER", joinedEpochNumber: 1 } },
        },
      });
      await prisma.groupEpoch.create({
        data: {
          id: `${prefix}-epoch`,
          groupId,
          epochNumber: 1,
          createdByDeviceId: deviceId,
          senderPublicKey: key.publicKey,
        },
      });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    test("rejects an incorrect recipient set and serializes competing rotations", async () => {
      const outsider = router.createCaller({
        cache,
        db: prisma,
        clientIp: "127.0.0.1",
        session: { user: { id: `${prefix}-outsider` } },
      } as Parameters<typeof router.createCaller>[0]);
      await expect(outsider.groupEpoch.rotationContext({ groupId })).rejects.toThrow(
        "not a member",
      );
      const context = await caller.groupEpoch.rotationContext({ groupId });
      if (!context?.latestEpoch) throw new Error("Missing rotation context");
      const next = createNextGroupEpoch({
        creator: { deviceId, privateKey: key.privateKey },
        previousEpoch: context.latestEpoch,
        recipients: context.recipients,
      });
      const nextEpoch = {
        createdByDeviceId: deviceId,
        epochId: next.epoch.epochId,
        epochNumber: next.epoch.epochNumber,
        historyKeys: [],
        recipientKeys: next.wrappedKeys,
      };
      await expect(
        caller.groupEpoch.rotate({
          groupId,
          nextEpoch: {
            ...nextEpoch,
            recipientKeys: nextEpoch.recipientKeys.map((recipient) => ({
              ...recipient,
              recipientDeviceId: "unexpected-device",
            })),
          },
        }),
      ).rejects.toThrow();
      await expect(
        caller.groupEpoch.rotate({
          groupId,
          nextEpoch: {
            ...nextEpoch,
            recipientKeys: nextEpoch.recipientKeys.map((recipient) => ({
              ...recipient,
              ephemeralPublicKey: Buffer.alloc(32).toString("base64"),
            })),
          },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await prisma.groupEpoch.count({ where: { groupId } })).toBe(1);
      const oversizedEpochId = "e".repeat(200_000);
      await expect(
        caller.groupEpoch.rotate({
          groupId,
          nextEpoch: {
            ...nextEpoch,
            epochId: oversizedEpochId,
            recipientKeys: nextEpoch.recipientKeys.map((recipient) => ({
              ...recipient,
              epochId: oversizedEpochId,
            })),
          },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await prisma.groupEpoch.count({ where: { groupId } })).toBe(1);
      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).toMatchObject({
        epochRotationRequired: true,
      });
      const results = await Promise.all([
        caller.groupEpoch.rotate({ groupId, nextEpoch }),
        caller.groupEpoch.rotate({ groupId, nextEpoch }),
      ]);
      expect(results.filter((result) => result.rotated)).toHaveLength(1);
      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).toMatchObject({
        epochRotationRequired: false,
      });
      expect(await prisma.groupEpoch.count({ where: { groupId } })).toBe(2);
      expect(
        await prisma.groupEpochRecipientKey.count({ where: { groupEpochId: nextEpoch.epochId } }),
      ).toBe(1);
    });
    test("deletion preserves remaining tracking and permits old uploads before and after rotation", async () => {
      const departing = `${prefix}-departing`;
      const departingDevice = `${prefix}-departing-device`;
      const survivingGroup = `${prefix}-deletion-group`;
      const departingKey = createDeviceKeyPair();
      await prisma.user.create({
        data: { id: departing, name: "Departing", email: `${departing}@example.test` },
      });
      await prisma.userDevice.create({
        data: {
          id: departingDevice,
          userId: departing,
          publicKey: departingKey.publicKey,
          publicKeyAlgorithm: "X25519",
        },
      });
      await prisma.group.create({
        data: {
          id: survivingGroup,
          name: "Family",
          groupMembers: {
            create: [
              { userId, role: "OWNER", joinedEpochNumber: 1 },
              { userId: departing, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
        },
      });
      const devices = await prisma.userDevice.findMany({
        where: { id: { in: [deviceId, departingDevice] } },
      });
      const initial = createInitialGroupEpoch({
        groupId: survivingGroup,
        creator: { deviceId: departingDevice, privateKey: departingKey.privateKey },
        recipients: devices.map((device) => ({
          algorithm: "X25519",
          createdAt: device.createdAt,
          deviceId: device.id,
          publicKey: device.publicKey,
          revokedAt: device.revokedAt,
          userId: device.userId,
        })),
      });
      await prisma.groupEpoch.create({
        data: {
          id: initial.epoch.epochId,
          groupId: survivingGroup,
          epochNumber: 1,
          createdByDeviceId: departingDevice,
          senderPublicKey: departingKey.publicKey,
          recipientKeys: {
            create: initial.wrappedKeys.map(
              ({ recipientDeviceId, wrappedKey, ephemeralPublicKey, algorithm, createdAt }) => ({
                recipientDeviceId,
                wrappedKey,
                ephemeralPublicKey,
                algorithm,
                createdAt,
              }),
            ),
          },
        },
      });
      const encrypted = encryptGroupPayload({
        epochId: initial.epoch.epochId,
        epochKey: initial.epochKey,
        groupId: survivingGroup,
        kind: TRACKING_POINT_KIND,
        payload: { latitude: 51, longitude: -1 },
        senderDeviceId: deviceId,
      });
      try {
        await caller.groupTracking.uploadBatch({
          groupId: survivingGroup,
          points: [{ ...encrypted, clientPointId: `${prefix}-before` }],
        });
        expect(
          await deleteAccountRecords({
            db: prisma,
            userId: departing,
            mode: "immediate",
            imageUrlPrefix: "https://cdn.example/bucket",
          }),
        ).toBe(true);
        expect(
          (await prisma.groupEpoch.findUniqueOrThrow({ where: { id: initial.epoch.epochId } }))
            .createdByDeviceId,
        ).toBeNull();
        expect(
          (await prisma.group.findUniqueOrThrow({ where: { id: survivingGroup } }))
            .epochRotationRequired,
        ).toBe(true);
        await caller.groupTracking.uploadBatch({
          groupId: survivingGroup,
          points: [{ ...encrypted, clientPointId: `${prefix}-queued` }],
        });
        const context = await caller.groupEpoch.rotationContext({ groupId: survivingGroup });
        if (!context?.latestEpoch) throw new Error("Missing rotation context");
        const next = createNextGroupEpoch({
          creator: { deviceId, privateKey: key.privateKey },
          previousEpoch: context.latestEpoch,
          recipients: context.recipients,
        });
        await caller.groupEpoch.rotate({
          groupId: survivingGroup,
          nextEpoch: {
            createdByDeviceId: deviceId,
            epochId: next.epoch.epochId,
            epochNumber: next.epoch.epochNumber,
            historyKeys: [],
            recipientKeys: next.wrappedKeys,
          },
        });
        expect(
          unwrapEpochKey({
            recipientDeviceId: deviceId,
            recipientPrivateKey: key.privateKey,
            wrappedEpochKey: next.wrappedKeys[0]!,
          }).expose(),
        ).toEqual(next.epochKey.expose());
        await caller.groupTracking.uploadBatch({
          groupId: survivingGroup,
          points: [{ ...encrypted, clientPointId: `${prefix}-after` }],
        });
        expect(
          await prisma.groupEncryptedPayload.count({
            where: { groupId: survivingGroup, senderUserId: userId },
          }),
        ).toBe(3);
        expect(
          (await prisma.group.findUniqueOrThrow({ where: { id: survivingGroup } }))
            .epochRotationRequired,
        ).toBe(false);
      } finally {
        await prisma.group.deleteMany({ where: { id: survivingGroup } });
        await prisma.user.deleteMany({ where: { id: departing } });
        await prisma.accountDeletionCleanup.deleteMany({ where: { userId: departing } });
      }
    });
  },
);
