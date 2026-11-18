import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { prisma } from "@openbeacon/database";
import { createDeviceKeyPair, generateGroupEpochKey } from "@openbeacon/encryption";
import type { HistoryShare } from "@openbeacon/shared";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import {
  encryptedTrackingPoint,
  storeTrackingPoints,
  testClientPointId,
} from "../../lib/trackingPoints.testUtil.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { accountRouter } from "../accountRouter.ts";
import { groupSettingsRouter } from "./groupSettingsRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";

const prefix = `history-share-${crypto.randomUUID()}`;
const ownerId = `${prefix}-owner`;
const sharerId = `${prefix}-sharer`;
const quietId = `${prefix}-quiet`;
const ownerDeviceId = `${prefix}-owner-device`;
const sharerDeviceId = `${prefix}-sharer-device`;
const quietDeviceId = `${prefix}-quiet-device`;
const userIds = [ownerId, sharerId, quietId];
const familyId = `${prefix}-family`;
const clubId = `${prefix}-club`;
const groupIds = [familyId, clubId];
const epochKey = generateGroupEpochKey();
const senderPublicKey = createDeviceKeyPair().publicKey;
const cache = {
  rateLimits: {
    consume: async () => ({ allowed: true }),
    take: async (input: { cost?: number }) => ({ granted: input.cost ?? 1, remaining: 2_880 }),
    refund: async () => {},
  },
};
const router = createTRPCRouter({
  account: accountRouter,
  groupSettings: groupSettingsRouter,
  groupTracking: groupTrackingRouter,
});
const caller = (userId: string, deviceId: string) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId,
      session: { user: { id: userId }, session: { id: `${userId}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );

const nowHour = () => Math.floor(Date.now() / 3_600_000);
const epochId = (groupId: string) => `${groupId}-epoch`;
const store = (groupId: string, capturedHour: number, senderUserId = sharerId) =>
  storeTrackingPoints(prisma, {
    capturedHour,
    receivedHour: Math.max(capturedHour, nowHour() - 300),
    epochId: epochId(groupId),
    groupId,
    senderDeviceId: senderUserId === sharerId ? sharerDeviceId : quietDeviceId,
    senderUserId,
  });
const storedHours = async (groupId: string, senderUserId = sharerId) =>
  (
    await prisma.$queryRaw<Array<{ capturedHour: number }>>`
      SELECT "point"."capturedHour" FROM "TrackingPoint" AS "point"
      JOIN "TrackingStream" AS "stream" ON "stream"."id" = "point"."streamId"
      WHERE "stream"."groupId" = ${groupId} AND "stream"."senderUserId" = ${senderUserId}
      ORDER BY "point"."capturedHour"
    `
  ).map(({ capturedHour }) => nowHour() - capturedHour);
const setAccount = (userId: string, historyShare: HistoryShare) =>
  prisma.user.update({ where: { id: userId }, data: { historyShare } });
const setOverride = (userId: string, groupId: string, historyShare: HistoryShare | null) =>
  prisma.groupMember.update({
    where: { userId_groupId: { userId, groupId } },
    data: { historyShare },
  });

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "choosing how much history to share, with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: userIds.map((id) => ({ id, name: id, email: `${id}@example.test` })),
      });
      await prisma.userDevice.createMany({
        data: [
          { id: ownerDeviceId, userId: ownerId },
          { id: sharerDeviceId, userId: sharerId },
          { id: quietDeviceId, userId: quietId },
        ].map((device) => ({
          ...device,
          publicKey: createDeviceKeyPair().publicKey,
          publicKeyAlgorithm: "X25519",
          name: "Phone",
          icon: "phone" as const,
          activatedAt: new Date(),
        })),
      });
      for (const groupId of groupIds) {
        await prisma.group.create({
          data: {
            id: groupId,
            name: groupId,
            groupMembers: {
              create: [
                { userId: ownerId, role: "OWNER", joinedEpochNumber: 1 },
                { userId: sharerId, role: "MEMBER", joinedEpochNumber: 1 },
                { userId: quietId, role: "MEMBER", joinedEpochNumber: 1 },
              ],
            },
          },
        });
        await prisma.groupEpoch.create({
          data: {
            id: epochId(groupId),
            groupId,
            epochNumber: 1,
            createdByDeviceId: ownerDeviceId,
            senderPublicKey,
          },
        });
      }
    });

    beforeEach(async () => {
      await prisma.trackingStream.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.user.updateMany({
        where: { id: { in: userIds } },
        data: { historyShare: "MAXIMUM", historyShareChangedAt: null },
      });
      await prisma.groupMember.updateMany({
        where: { groupId: { in: groupIds } },
        data: { historyShare: null },
      });
    });

    afterAll(async () => {
      await prisma.trackingLatestPoint.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    });

    test("reads keep each sender's points to whole recorded hours inside their window", async () => {
      await setAccount(sharerId, "DAY_1");
      await setOverride(sharerId, familyId, "HOURS_6");
      for (const hoursAgo of [0, 5, 6, 30]) await store(familyId, nowHour() - hoursAgo);
      for (const hoursAgo of [0, 23, 24]) await store(clubId, nowHour() - hoursAgo);
      for (const hoursAgo of [0, 200]) await store(familyId, nowHour() - hoursAgo, quietId);
      const viewer = caller(ownerId, ownerDeviceId).groupTracking;

      const familyDays = await viewer.historyDays({ groupId: familyId });
      const sharerHours = familyDays.devices.find(
        ({ senderUserId }) => senderUserId === sharerId,
      )?.hours;
      expect(sharerHours?.map(({ hour }) => nowHour() - hour)).toEqual([5, 0]);
      expect(
        familyDays.devices.find(({ senderUserId }) => senderUserId === quietId)?.hours,
      ).toHaveLength(2);
      expect(familyDays.senders.find(({ userId }) => userId === sharerId)).toEqual({
        userId: sharerId,
        historyShare: "HOURS_6",
        firstHour: nowHour() - 5,
      });
      expect(familyDays.senders.find(({ userId }) => userId === quietId)).toEqual({
        userId: quietId,
        historyShare: "MAXIMUM",
        firstHour: null,
      });

      const clubRange = await viewer.historyRange({
        groupId: clubId,
        fromHour: nowHour() - 25,
        toHour: nowHour() + 1,
      });
      const clubStreams = new Map(clubRange.streams.map((stream) => [stream.id, stream]));
      expect(
        clubRange.points
          .filter(({ streamId }) => clubStreams.get(streamId)?.senderUserId === sharerId)
          .map(({ capturedHour }) => nowHour() - capturedHour),
      ).toEqual([23, 0]);

      const familyRange = await viewer.historyRange({
        groupId: familyId,
        fromHour: nowHour() - 2,
        toHour: nowHour() + 1,
      });
      const familyStreams = new Map(familyRange.streams.map((stream) => [stream.id, stream]));
      expect(
        familyRange.lookback
          .filter(({ streamId }) => familyStreams.get(streamId)?.senderUserId === sharerId)
          .map(({ capturedHour }) => nowHour() - capturedHour),
      ).toEqual([5]);
      expect(
        familyRange.lookback
          .filter(({ streamId }) => familyStreams.get(streamId)?.senderUserId === quietId)
          .map(({ capturedHour }) => nowHour() - capturedHour),
      ).toEqual([200]);
    });

    test("last location only leaves the sender out of history reads", async () => {
      await setOverride(sharerId, clubId, "LAST_LOCATION");
      await store(clubId, nowHour());
      await store(clubId, nowHour() + 1);
      const viewer = caller(ownerId, ownerDeviceId).groupTracking;

      const days = await viewer.historyDays({ groupId: clubId });
      expect(days.devices).toEqual([]);
      expect(days.senders.find(({ userId }) => userId === sharerId)?.historyShare).toBe(
        "LAST_LOCATION",
      );
      const range = await viewer.historyRange({
        groupId: clubId,
        fromHour: nowHour() - 1,
        toHour: nowHour() + 2,
      });
      expect(range.points).toEqual([]);
      expect(range.lookback).toEqual([]);
    });

    test("shortening the account setting deletes older points in groups that follow it", async () => {
      await setOverride(sharerId, clubId, "MAXIMUM");
      for (const groupId of groupIds) {
        for (const hoursAgo of [0, 23, 24, 100]) await store(groupId, nowHour() - hoursAgo);
      }
      await store(familyId, nowHour() - 100, quietId);

      const result = await caller(sharerId, sharerDeviceId).account.setHistoryShare({
        historyShare: "DAY_1",
      });

      expect(result.historyShare).toBe("DAY_1");
      expect(result.deletedPoints).toBe(2);
      expect(result.changedAt).toBeInstanceOf(Date);
      expect(await storedHours(familyId)).toEqual([23, 0]);
      expect(await storedHours(clubId)).toEqual([100, 24, 23, 0]);
      expect(await storedHours(familyId, quietId)).toEqual([100]);
    });

    test("lengthening keeps deleted points deleted and only applies going forward", async () => {
      for (const hoursAgo of [0, 10]) await store(familyId, nowHour() - hoursAgo);
      const sharer = caller(sharerId, sharerDeviceId);
      await sharer.account.setHistoryShare({ historyShare: "HOURS_6" });
      expect(await storedHours(familyId)).toEqual([0]);

      await sharer.account.setHistoryShare({ historyShare: "WEEK_1" });
      expect(await storedHours(familyId)).toEqual([0]);
      await store(familyId, nowHour() - 10);
      const days = await caller(ownerId, ownerDeviceId).groupTracking.historyDays({
        groupId: familyId,
      });
      expect(
        days.devices
          .find(({ senderUserId }) => senderUserId === sharerId)
          ?.hours.map(({ hour }) => nowHour() - hour),
      ).toEqual([10, 0]);
    });

    test("lengthening never brings back points that aged out of the old window before the job ran", async () => {
      await setAccount(sharerId, "DAY_1");
      await setOverride(sharerId, clubId, "HOURS_6");
      for (const groupId of groupIds) {
        for (const hoursAgo of [0, 10, 30]) await store(groupId, nowHour() - hoursAgo);
      }
      const sharer = caller(sharerId, sharerDeviceId);

      await sharer.account.setHistoryShare({ historyShare: "WEEK_1" });
      expect(await storedHours(familyId)).toEqual([10, 0]);
      expect(await storedHours(clubId)).toEqual([30, 10, 0]);

      await sharer.groupSettings.setHistoryShare({ groupId: clubId, historyShare: "MAXIMUM" });
      expect(await storedHours(clubId)).toEqual([0]);
    });

    test("a group override deletes only in its group, and clearing it falls back to the account", async () => {
      await setAccount(sharerId, "WEEK_1");
      for (const groupId of groupIds) {
        for (const hoursAgo of [0, 6, 30]) await store(groupId, nowHour() - hoursAgo);
      }
      const sharer = caller(sharerId, sharerDeviceId).groupSettings;

      const shortened = await sharer.setHistoryShare({
        groupId: familyId,
        historyShare: "HOURS_6",
      });
      expect(shortened).toMatchObject({ override: "HOURS_6", historyShare: "HOURS_6" });
      expect(await storedHours(familyId)).toEqual([0]);
      expect(await storedHours(clubId)).toEqual([30, 6, 0]);

      const cleared = await sharer.setHistoryShare({ groupId: clubId, historyShare: null });
      expect(cleared).toMatchObject({ override: null, historyShare: "WEEK_1", deletedPoints: 0 });

      const lastOnly = await sharer.setHistoryShare({
        groupId: clubId,
        historyShare: "LAST_LOCATION",
      });
      expect(lastOnly.deletedPoints).toBe(3);
      expect(await storedHours(clubId)).toEqual([]);
    });

    test("only the person can change their own setting; an owner's change touches only their own row", async () => {
      await store(familyId, nowHour() - 30);
      const owner = caller(ownerId, ownerDeviceId);

      await owner.groupSettings.setHistoryShare({
        groupId: familyId,
        historyShare: "HOURS_6",
        userId: sharerId,
      } as Parameters<typeof owner.groupSettings.setHistoryShare>[0]);
      await owner.account.setHistoryShare({
        historyShare: "LAST_LOCATION",
        userId: sharerId,
      } as Parameters<typeof owner.account.setHistoryShare>[0]);

      const members = await prisma.groupMember.findMany({
        where: { groupId: familyId },
        select: { userId: true, historyShare: true },
      });
      expect(members.find(({ userId }) => userId === ownerId)?.historyShare).toBe("HOURS_6");
      expect(members.find(({ userId }) => userId === sharerId)?.historyShare).toBeNull();
      expect((await prisma.user.findUniqueOrThrow({ where: { id: sharerId } })).historyShare).toBe(
        "MAXIMUM",
      );
      expect(await storedHours(familyId)).toEqual([30]);

      const outsider = `${prefix}-outsider-group`;
      await expect(
        caller(sharerId, sharerDeviceId).groupSettings.setHistoryShare({
          groupId: outsider,
          historyShare: "HOURS_6",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    test("uploads discard history rows outside the window but still update the latest point", async () => {
      const upload = (points: ReturnType<typeof encryptedTrackingPoint>[]) =>
        caller(sharerId, sharerDeviceId).groupTracking.uploadBatch({ groupId: familyId, points });
      const point = (
        seed: string,
        overrides: Partial<Parameters<typeof encryptedTrackingPoint>[0]> = {},
      ) =>
        encryptedTrackingPoint({
          clientPointId: testClientPointId(`${prefix}-${seed}`),
          epochId: epochId(familyId),
          epochKey,
          groupId: familyId,
          senderDeviceId: sharerDeviceId,
          ...overrides,
        });

      await setOverride(sharerId, familyId, "HOURS_6");
      const inside = point("inside", { capturedHour: nowHour() - 5 });
      const edge = point("edge", { capturedHour: nowHour() - 6 });
      const stay = point("old-stay", { capturedHour: nowHour() - 8, role: "STAY" });
      const result = await upload([inside, edge, stay]);
      expect(result.accepted).toEqual([inside.clientPointId]);
      expect(result.discarded.sort()).toEqual([edge.clientPointId, stay.clientPointId].sort());
      expect(await storedHours(familyId)).toEqual([5]);

      await setOverride(sharerId, familyId, "LAST_LOCATION");
      const history = point("last-only-history", { capturedHour: nowHour() });
      const live = point("last-only-live", { role: "LIVE" });
      const lastOnly = await upload([history, live]);
      expect(lastOnly.discarded).toEqual([history.clientPointId]);
      expect(lastOnly.accepted).toEqual([live.clientPointId]);
      expect(await storedHours(familyId)).toEqual([5]);
      const latest = await prisma.trackingLatestPoint.findUniqueOrThrow({
        where: { groupId_senderDeviceId: { groupId: familyId, senderDeviceId: sharerDeviceId } },
      });
      expect(Buffer.from(latest.payload.subarray(24)).toString("base64")).toBe(live.ciphertext);

      const historyOnly = point("last-only-history-without-live", { capturedHour: nowHour() });
      const historyOnlyResult = await upload([historyOnly]);
      expect(historyOnlyResult.discarded).toEqual([historyOnly.clientPointId]);
      expect(historyOnlyResult.accepted).toEqual([]);
      expect(await storedHours(familyId)).toEqual([5]);
      const moved = await prisma.trackingLatestPoint.findUniqueOrThrow({
        where: { groupId_senderDeviceId: { groupId: familyId, senderDeviceId: sharerDeviceId } },
      });
      expect(Buffer.from(moved.payload.subarray(24)).toString("base64")).toBe(
        historyOnly.ciphertext,
      );
    });

    test("the account query returns the setting and each group's override for account sync", async () => {
      await setAccount(sharerId, "WEEK_1");
      await setOverride(sharerId, clubId, "LAST_LOCATION");
      const sharing = await caller(sharerId, sharerDeviceId).account.locationSharing();
      expect(sharing.historyShare.account).toBe("WEEK_1");
      expect(sharing.historyShare.groups).toEqual(
        [
          { groupId: familyId, historyShare: null },
          { groupId: clubId, historyShare: "LAST_LOCATION" },
        ].sort((first, second) => first.groupId.localeCompare(second.groupId)),
      );
    });
  },
);
