import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  encryptGroupPayload,
  generateGroupEpochKey,
} from "@openbeacon/encryption";
import { TRACKING_POINT_KIND, type setLocationSharingSchema } from "@openbeacon/schemas";
import type { z } from "zod";
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
const setSharing = async (
  change: Partial<
    Omit<z.input<typeof setLocationSharingSchema>, "scope" | "deviceId" | "paused">
  > & { paused: boolean } & ({ scope: "account" } | { scope: "device"; deviceId: string }),
  sharingCaller: ReturnType<typeof caller> = caller(),
) => {
  const current =
    change.scope === "account"
      ? await prisma.user.findUnique({ where: { id: userId } })
      : await prisma.userDevice.findUnique({ where: { id: change.deviceId } });
  const durationMinutes = change.durationMinutes ?? null;
  return sharingCaller.account.setLocationSharing({
    expectedUserId: userId,
    requestId: crypto.randomUUID(),
    expectedRevision: current?.sharingRevision ?? 0,
    replacesRequestId: null,
    durationMinutes,
    pausedUntil: durationMinutes === null ? null : new Date(Date.now() + durationMinutes * 60_000),
    ...change,
  });
};
const revisionOf = async (deviceId: string) =>
  (await prisma.userDevice.findUniqueOrThrow({ where: { id: deviceId } })).sharingRevision;
const reset = async () => {
  const data = {
    sharingPaused: false,
    sharingPausedUntil: null,
    sharingChangedAt: null,
    sharingRevision: 0,
    sharingRequestId: null,
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
      await setSharing({
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
      await setSharing({
        scope: "device",
        deviceId: tabletId,
        paused: true,
        durationMinutes: null,
      });
      expect(
        (await caller().groupTracking.uploadBatch({ groupId, points: [delayed] })).discarded,
      ).toEqual([delayed.clientPointId]);
      await setSharing({
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
      await setSharing({
        scope: "device",
        deviceId: tabletId,
        paused: true,
        durationMinutes: null,
      });
      await setSharing({
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
      await setSharing({
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
      await setSharing({
        scope: "device",
        deviceId: phoneId,
        paused: true,
        durationMinutes: 15,
      });
      const preference = await prisma.userDevice.findUniqueOrThrow({ where: { id: phoneId } });
      expect(
        preference.sharingPausedUntil!.getTime() - preference.sharingChangedAt!.getTime(),
      ).toBeWithin(15 * 60_000 - 5_000, 15 * 60_000 + 1);
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
        setSharing({
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
      await setSharing({
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
          setSharing({ scope: "account", paused: false }, authenticatedBeforeRemoval),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        await expect(authenticatedBeforeRemoval.account.locationSharing()).rejects.toMatchObject({
          code: "UNAUTHORIZED",
          message: "This phone was removed from your account.",
        });
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
        setSharing({ scope: "device", deviceId: phoneId, paused: true }),
      ]);
      expect(
        (await caller(otherId, otherDeviceId).groupTracking.getLatest({ groupId })).points,
      ).toEqual([]);
    });

    test("a retried pause whose reply was lost does not restart its timer", async () => {
      await reset();
      const request = {
        scope: "device" as const,
        deviceId: tabletId,
        paused: true,
        durationMinutes: 15 as const,
        requestId: crypto.randomUUID(),
        expectedRevision: 0,
        pausedUntil: new Date(Date.now() + 15 * 60_000),
      };
      expect(await setSharing(request)).toEqual({ status: "applied" });
      const first = await prisma.userDevice.findUniqueOrThrow({
        where: { id: tabletId },
      });
      expect(await setSharing(request)).toEqual({ status: "applied" });
      const retried = await prisma.userDevice.findUniqueOrThrow({
        where: { id: tabletId },
      });
      expect(retried.sharingRevision).toBe(1);
      expect(retried.sharingPausedUntil).toEqual(first.sharingPausedUntil);
      expect(retried.sharingChangedAt).toEqual(first.sharingChangedAt);
    });

    test("a replayed pause cannot undo a resume made on another phone", async () => {
      await reset();
      await setSharing({ scope: "device", deviceId: tabletId, paused: true });
      const queuedPause = {
        scope: "device" as const,
        deviceId: tabletId,
        expectedRevision: 1,
      };
      await setSharing({ scope: "device", deviceId: tabletId, paused: false });
      expect(await setSharing({ ...queuedPause, paused: true })).toEqual({
        status: "superseded",
      });
      expect((await caller(userId, tabletId).account.locationSharing()).paused).toBe(false);
      expect(await revisionOf(tabletId)).toBe(2);
      expect(await setSharing({ ...queuedPause, paused: true, expectedRevision: null })).toEqual({
        status: "applied",
      });
      expect((await caller(userId, tabletId).account.locationSharing()).paused).toBe(true);
    });

    test("a resume replacing a queued pause still resumes after the pause reached the server", async () => {
      await reset();
      const pauseId = crypto.randomUUID();
      await setSharing({
        scope: "device",
        deviceId: tabletId,
        paused: true,
        requestId: pauseId,
        expectedRevision: 0,
      });
      expect(
        await setSharing({
          scope: "device",
          deviceId: tabletId,
          paused: false,
          expectedRevision: 0,
          replacesRequestId: pauseId,
        }),
      ).toEqual({ status: "applied" });
      expect((await caller(userId, tabletId).account.locationSharing()).paused).toBe(false);
      expect(
        await setSharing({
          scope: "device",
          deviceId: tabletId,
          paused: false,
          expectedRevision: 0,
          replacesRequestId: crypto.randomUUID(),
        }),
      ).toEqual({ status: "superseded" });
    });

    test("an offline pause ends at the time chosen when it was tapped", async () => {
      await reset();
      const tappedAt = Date.now() - 10 * 60_000;
      await setSharing({
        scope: "device",
        deviceId: tabletId,
        paused: true,
        durationMinutes: 15,
        pausedUntil: new Date(tappedAt + 15 * 60_000),
      });
      expect(
        (await prisma.userDevice.findUniqueOrThrow({ where: { id: tabletId } })).sharingPausedUntil,
      ).toEqual(new Date(tappedAt + 15 * 60_000));
      await setSharing({
        scope: "device",
        deviceId: tabletId,
        paused: true,
        durationMinutes: 15,
        pausedUntil: new Date(Date.now() + 24 * 60 * 60_000),
      });
      const clamped = await prisma.userDevice.findUniqueOrThrow({
        where: { id: tabletId },
      });
      expect(clamped.sharingPausedUntil!.getTime()).toBeLessThanOrEqual(
        clamped.sharingChangedAt!.getTime() + 15 * 60_000,
      );
    });

    test("a pause that already ended pauses nothing but still discards points from before it", async () => {
      await reset();
      const delayed = point(tabletId);
      expect(
        await setSharing({
          scope: "device",
          deviceId: tabletId,
          paused: true,
          durationMinutes: 15,
          pausedUntil: new Date(Date.now() - 60_000),
        }),
      ).toEqual({ status: "expired" });
      const sharing = await caller(userId, tabletId).account.locationSharing();
      expect(sharing.paused).toBe(false);
      expect(sharing.device.sharingRevision).toBe(1);
      expect(
        (
          await caller().groupTracking.uploadBatch({
            groupId,
            points: [delayed],
          })
        ).discarded,
      ).toEqual([delayed.clientPointId]);
    });

    test("changes that alter nothing keep the revision", async () => {
      await reset();
      expect(
        await setSharing({
          scope: "device",
          deviceId: tabletId,
          paused: false,
        }),
      ).toEqual({
        status: "applied",
      });
      expect(await revisionOf(tabletId)).toBe(0);
      await setSharing({ scope: "device", deviceId: tabletId, paused: true });
      await setSharing({ scope: "device", deviceId: tabletId, paused: true });
      expect(await revisionOf(tabletId)).toBe(1);
    });

    test("reports the server time so phones can correct their clocks", async () => {
      const before = Date.now();
      const { serverTime } = await caller().account.locationSharing();
      expect(serverTime.getTime()).toBeWithin(before, Date.now() + 1);
    });
  },
);
