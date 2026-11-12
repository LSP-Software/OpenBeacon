import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  encryptGroupPayload,
  generateGroupEpochKey,
} from "@openbeacon/encryption";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import { withDeviceActive } from "../lib/deviceContext.testUtil.ts";
import { createTRPCRouter } from "../trpcRuntime.ts";
import { accountRouter } from "./accountRouter.ts";
import { groupTrackingRouter } from "./group/groupTrackingRouter.ts";

const prefix = `sharing-${crypto.randomUUID()}`;
const userId = `${prefix}-user`;
const otherId = `${prefix}-other`;
const phoneId = `${prefix}-phone`;
const tabletId = `${prefix}-tablet`;
const otherDeviceId = `${prefix}-other-phone`;
const groupId = `${prefix}-group`;
const epochId = `${prefix}-epoch`;
const keys = createDeviceKeyPair();
const epochKey = generateGroupEpochKey();
const cache = createIntegrationTestCache(() => 0);
const router = createTRPCRouter({ account: accountRouter, groupTracking: groupTrackingRouter });
const caller = (ownerId = userId, deviceId = phoneId) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId,
      session: { user: { id: ownerId }, session: { id: `${ownerId}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );
const point = (deviceId: string, revisionPrefix = "") => ({
  ...encryptGroupPayload({
    epochId,
    epochKey,
    groupId,
    kind: TRACKING_POINT_KIND,
    senderDeviceId: deviceId,
    payload: { latitude: 51, longitude: 0, timestamp: new Date().toISOString() },
  }),
  clientPointId: `${revisionPrefix}${crypto.randomUUID()}`,
});
const reset = async () => {
  const data = {
    sharingPaused: false,
    sharingPausedUntil: null,
    sharingChangedAt: null,
    sharingRevision: 0,
  };
  await prisma.groupEncryptedPayload.deleteMany({ where: { groupId } });
  await prisma.user.update({ where: { id: userId }, data });
  await prisma.userDevice.updateMany({ where: { userId }, data });
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "location sharing with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: [userId, otherId].map((id) => ({ id, name: "Alex", email: `${id}@example.test` })),
      });
      await prisma.userDevice.createMany({
        data: [
          { id: phoneId, userId },
          { id: tabletId, userId },
          { id: otherDeviceId, userId: otherId },
        ].map((device) => ({
          ...device,
          name: device.id,
          icon: "phone" as const,
          publicKey: keys.publicKey,
          publicKeyAlgorithm: keys.algorithm,
          activatedAt: new Date(),
        })),
      });
      await prisma.session.createMany({
        data: [
          { userId, deviceId: phoneId },
          { userId: otherId, deviceId: otherDeviceId },
        ].map((session) => ({
          ...session,
          id: `${session.userId}-session`,
          token: `${session.userId}-token`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        })),
      });
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Family",
          groupMembers: {
            create: [
              { userId, role: "OWNER", joinedEpochNumber: 1 },
              { userId: otherId, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
        },
      });
      await prisma.groupEpoch.create({
        data: {
          id: epochId,
          groupId,
          epochNumber: 1,
          createdByDeviceId: phoneId,
          senderPublicKey: keys.publicKey,
        },
      });
    });
    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
      await prisma.$disconnect();
    });

    test("pausing the tablet hides its previous location while the phone keeps sharing", async () => {
      await reset();
      await caller().groupTracking.uploadBatch({
        groupId,
        points: [point(phoneId), point(tabletId)],
      });
      await caller().account.setLocationSharing({
        expectedUserId: userId,
        scope: "device",
        deviceId: tabletId,
        paused: true,
        durationMinutes: null,
      });
      const latest = await caller(otherId, otherDeviceId).groupTracking.getLatest({ groupId });
      expect(latest.points.map((row) => row.senderDeviceId)).toEqual([phoneId]);
      expect(latest.sharing.find((device) => device.deviceId === tabletId)?.paused).toBe(true);
      expect(latest.sharing.find((device) => device.deviceId === phoneId)?.paused).toBe(false);
      const poll = await caller(otherId, otherDeviceId).groupTracking.poll({ groupId });
      expect(poll.points.map((row) => row.senderDeviceId)).toEqual([phoneId]);
    });

    test("discards delayed points from before pausing and waits for the resumed revision", async () => {
      await reset();
      const delayed = point(tabletId);
      await caller().groupTracking.uploadBatch({ groupId, points: [point(tabletId)] });
      await caller().account.setLocationSharing({
        expectedUserId: userId,
        scope: "device",
        deviceId: tabletId,
        paused: true,
        durationMinutes: null,
      });
      expect(
        (await caller().groupTracking.uploadBatch({ groupId, points: [delayed] })).discarded,
      ).toEqual([delayed.clientPointId]);
      await caller().account.setLocationSharing({
        expectedUserId: userId,
        scope: "device",
        deviceId: tabletId,
        paused: false,
        durationMinutes: null,
      });
      expect((await caller().groupTracking.getLatest({ groupId })).points).toEqual([]);
      expect(
        (await caller().groupTracking.uploadBatch({ groupId, points: [delayed] })).discarded,
      ).toEqual([delayed.clientPointId]);
      const sharing = await caller(userId, tabletId).account.locationSharing();
      const fresh = point(tabletId, sharing.revisionPrefix);
      expect(
        (await caller().groupTracking.uploadBatch({ groupId, points: [fresh] })).accepted,
      ).toEqual([fresh.clientPointId]);
      expect(
        (await caller().groupTracking.getLatest({ groupId })).points.map(
          (row) => row.clientPointId,
        ),
      ).toEqual([fresh.clientPointId]);
    });

    test("an account pause overrides all devices and preserves their own pauses", async () => {
      await reset();
      await caller().account.setLocationSharing({
        expectedUserId: userId,
        scope: "device",
        deviceId: tabletId,
        paused: true,
        durationMinutes: null,
      });
      await caller().account.setLocationSharing({
        expectedUserId: userId,
        scope: "account",
        paused: true,
        durationMinutes: 60,
      });
      expect((await caller().account.locationSharing()).paused).toBe(true);
      const newDeviceId = `${prefix}-new`;
      await prisma.userDevice.create({
        data: {
          id: newDeviceId,
          userId,
          name: "New phone",
          icon: "phone",
          publicKey: keys.publicKey,
          publicKeyAlgorithm: keys.algorithm,
          activatedAt: new Date(),
        },
      });
      expect((await caller(userId, newDeviceId).account.locationSharing()).paused).toBe(true);
      await caller().account.setLocationSharing({
        expectedUserId: userId,
        scope: "account",
        paused: false,
        durationMinutes: null,
      });
      expect((await caller().account.locationSharing()).paused).toBe(false);
      expect((await caller(userId, tabletId).account.locationSharing()).paused).toBe(true);
      expect((await caller(userId, newDeviceId).account.locationSharing()).paused).toBe(false);
    });

    test("a timed pause expires without restoring points captured before the pause", async () => {
      await reset();
      const old = point(phoneId);
      await caller().groupTracking.uploadBatch({ groupId, points: [old] });
      await caller().account.setLocationSharing({
        expectedUserId: userId,
        scope: "device",
        deviceId: phoneId,
        paused: true,
        durationMinutes: 15,
      });
      const preference = await prisma.userDevice.findUniqueOrThrow({ where: { id: phoneId } });
      expect(
        preference.sharingPausedUntil!.getTime() - preference.sharingChangedAt!.getTime(),
      ).toBe(15 * 60_000);
      await prisma.userDevice.update({
        where: { id: phoneId },
        data: { sharingPausedUntil: new Date(Date.now() - 1) },
      });
      const sharing = await caller().account.locationSharing();
      expect(sharing.paused).toBe(false);
      expect((await caller().groupTracking.getLatest({ groupId })).points).toEqual([]);
      expect(
        (await caller().groupTracking.uploadBatch({ groupId, points: [point(phoneId)] })).accepted,
      ).toEqual([]);
      expect(
        (
          await caller().groupTracking.uploadBatch({
            groupId,
            points: [point(phoneId, sharing.revisionPrefix)],
          })
        ).accepted,
      ).toHaveLength(1);
    });

    test("cannot change another account's device", async () => {
      await expect(
        caller().account.setLocationSharing({
          expectedUserId: userId,
          scope: "device",
          deviceId: otherDeviceId,
          paused: true,
          durationMinutes: null,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await caller(otherId, otherDeviceId).account.locationSharing()).paused).toBe(false);
    });

    test("a phone revoked after authentication cannot resume the account", async () => {
      await reset();
      await caller().account.setLocationSharing({
        expectedUserId: userId,
        scope: "account",
        paused: true,
        durationMinutes: null,
      });
      const authenticatedBeforeRemoval = router.createCaller({
        cache,
        db: prisma,
        clientIp: "127.0.0.1",
        deviceId: phoneId,
        deviceActive: true,
        session: { user: { id: userId }, session: { id: `${userId}-session` } },
      } as Parameters<typeof router.createCaller>[0]);
      await prisma.userDevice.update({ where: { id: phoneId }, data: { revokedAt: new Date() } });
      try {
        await expect(
          authenticatedBeforeRemoval.account.setLocationSharing({
            expectedUserId: userId,
            scope: "account",
            paused: false,
            durationMinutes: null,
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).sharingPaused).toBe(
          true,
        );
      } finally {
        await prisma.userDevice.update({ where: { id: phoneId }, data: { revokedAt: null } });
      }
    });

    test("a pause wins against an upload racing it", async () => {
      await reset();
      await Promise.all([
        caller().groupTracking.uploadBatch({ groupId, points: [point(phoneId)] }),
        caller().account.setLocationSharing({
          expectedUserId: userId,
          scope: "device",
          deviceId: phoneId,
          paused: true,
          durationMinutes: null,
        }),
      ]);
      expect(
        (await caller(otherId, otherDeviceId).groupTracking.getLatest({ groupId })).points,
      ).toEqual([]);
    });
  },
);
