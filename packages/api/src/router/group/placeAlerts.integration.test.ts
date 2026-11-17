import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { WRAPPED_EPOCH_KEY_ALGORITHM } from "@openbeacon/encryption";
import { deleteAccountRecords } from "../../lib/account-deletion.ts";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { encodePlaceAlertsCursor } from "../../lib/placeTransitions.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { notificationSettingsRouter } from "../notificationSettingsRouter.ts";
import { removeGroupMemberWithOwnerGuard } from "./assertGroupMemberCanBeRemoved.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";
import { placeAlertsRouter } from "./placeAlertsRouter.ts";

const router = createTRPCRouter({
  groupMembership: groupMembershipRouter,
  groupTracking: groupTrackingRouter,
  notificationSettings: notificationSettingsRouter,
  placeAlerts: placeAlertsRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `place-alerts-${crypto.randomUUID()}`;
const owner = `${prefix}-owner`;
const member = `${prefix}-member`;
const joiner = `${prefix}-joiner`;
const leaver = `${prefix}-leaver`;
const users = [owner, member, joiner, leaver];
const phoneOf = (userId: string) => `${userId}-phone`;
const groupId = `${prefix}-group`;
const otherGroupId = `${prefix}-other`;
const homeId = `${prefix}-home`;
const schoolId = `${prefix}-school`;
const otherPlaceId = `${prefix}-other-place`;
const minute = 60_000;
const longAgo = new Date(Date.now() - 30 * 24 * 60 * minute);

const caller = (userId: string) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId: phoneOf(userId),
      unverifiedDeviceId: null,
      session: { user: { id: userId }, session: { id: `${userId}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );

const setMute = (
  userId: string,
  {
    placeId = homeId,
    mutedUserId,
    muted = true,
  }: { placeId?: string; mutedUserId: string | null; muted?: boolean },
) => caller(userId).placeAlerts.setMute({ groupId, placeId, mutedUserId, muted });

const mutesOf = async (userId: string) =>
  (await caller(userId).placeAlerts.mutes({ groupId })).mutes;

const addMember = (userId: string) =>
  prisma.groupMember.create({
    data: { userId, groupId, role: "MEMBER", joinedEpochNumber: 1, createdAt: longAgo },
  });

const removeMember = async (userId: string) => {
  const target = await prisma.groupMember.findUniqueOrThrow({
    where: { userId_groupId: { userId, groupId } },
  });
  await prisma.$transaction((tx) =>
    removeGroupMemberWithOwnerGuard({ db: tx, groupId, memberId: target.id }),
  );
};

const seedArrivals = (rows: Array<{ id: string; userId: string; placeId: string }>) => {
  const createdAt = new Date(Date.now() - 5 * minute);
  return prisma.placeTransition.createMany({
    data: rows.map(({ id, userId, placeId }) => ({
      id: `${prefix}-${id}`,
      placeId,
      groupId,
      deviceId: phoneOf(userId),
      userId,
      direction: "ARRIVE" as const,
      occurredAt: createdAt,
      clientId: crypto.randomUUID(),
      createdAt,
    })),
  });
};

const pollAlerts = (userId: string, placeAlertsCursor: string) =>
  caller(userId).groupTracking.uploadBatch({
    groupId,
    points: [],
    placeTransitions: [
      {
        clientId: crypto.randomUUID(),
        placeId: homeId,
        direction: "LEAVE",
        occurredAt: new Date(),
        senderDeviceId: phoneOf(userId),
      },
    ],
    placeAlertsCursor,
  });

const alertIds = async (userId: string) => {
  const response = await pollAlerts(
    userId,
    encodePlaceAlertsCursor({ createdAt: new Date(Date.now() - 10 * minute), id: "" }),
  );
  return (response.placeAlerts?.alerts ?? []).map(({ id }) => id.slice(prefix.length + 1)).sort();
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "place alert mutes with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: users.map((id) => ({ id, name: id, email: `${id}@example.test` })),
      });
      await prisma.userDevice.createMany({
        data: users.map((userId) => ({
          id: phoneOf(userId),
          userId,
          name: `${userId} phone`,
          activatedAt: new Date(),
          icon: "phone" as const,
          publicKey: "public-key",
          publicKeyAlgorithm: "X25519",
        })),
      });
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Family",
          groupMembers: {
            create: [owner, member].map((userId, index) => ({
              userId,
              role: index === 0 ? ("OWNER" as const) : ("MEMBER" as const),
              joinedEpochNumber: 1,
              createdAt: longAgo,
            })),
          },
          groupEpochs: {
            create: [{ id: `${groupId}-epoch`, epochNumber: 1, senderPublicKey: "public-key" }],
          },
        },
      });
      await prisma.group.create({
        data: {
          id: otherGroupId,
          name: "Other",
          groupMembers: {
            create: [{ userId: owner, role: "OWNER", joinedEpochNumber: 1, createdAt: longAgo }],
          },
        },
      });
      await prisma.place.createMany({
        data: [
          { id: homeId, groupId, name: "Home" },
          { id: schoolId, groupId, name: "School" },
          { id: otherPlaceId, groupId: otherGroupId, name: "Away" },
        ].map((place) => ({
          ...place,
          emoji: "🏠",
          epochId: `${place.groupId}-epoch`,
          senderDeviceId: phoneOf(owner),
          algorithm: "XChaCha20-Poly1305",
          nonce: "nonce",
          ciphertext: `${place.id}-ciphertext`,
          createdByUserId: owner,
        })),
      });
    });

    beforeEach(async () => {
      await prisma.placeTransition.deleteMany({ where: { groupId } });
      await prisma.placeAlertMute.deleteMany({ where: { groupId } });
      await prisma.notificationSetting.deleteMany({ where: { userId: { in: users } } });
      await prisma.groupMember.deleteMany({
        where: { groupId, userId: { in: [joiner, leaver] } },
      });
      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: false } });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { in: [groupId, otherGroupId] } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    test("mutes for a person and for a whole place persist until cleared, and only for the muter", async () => {
      expect(await setMute(owner, { mutedUserId: member })).toEqual({ muted: true });
      expect(await setMute(owner, { mutedUserId: member })).toEqual({ muted: true });
      await setMute(owner, { placeId: schoolId, mutedUserId: null });
      await setMute(owner, { placeId: schoolId, mutedUserId: null });
      expect(await mutesOf(owner)).toEqual(
        [
          { placeId: homeId, mutedUserId: member },
          { placeId: schoolId, mutedUserId: null },
        ].sort((a, b) => a.placeId.localeCompare(b.placeId)),
      );
      expect(await mutesOf(member)).toEqual([]);

      expect(await setMute(owner, { mutedUserId: member, muted: false })).toEqual({
        muted: false,
      });
      expect(await mutesOf(owner)).toEqual([{ placeId: schoolId, mutedUserId: null }]);
      await setMute(owner, { placeId: schoolId, mutedUserId: null, muted: false });
      expect(await mutesOf(owner)).toEqual([]);
    });

    test("refuses a mute of yourself, a place in another group and someone outside the group", async () => {
      await expect(setMute(owner, { mutedUserId: owner })).rejects.toThrow(
        "You don't get alerts about yourself.",
      );
      await expect(setMute(owner, { placeId: otherPlaceId, mutedUserId: null })).rejects.toThrow(
        "This place no longer exists.",
      );
      await expect(setMute(owner, { mutedUserId: joiner })).rejects.toThrow(
        "This person is no longer in the group.",
      );
      await expect(caller(joiner).placeAlerts.mutes({ groupId })).rejects.toThrow();
      expect(await prisma.placeAlertMute.count({ where: { groupId } })).toBe(0);
    });

    test("muted arrivals are left out of the muter's alerts, including people who join later", async () => {
      await setMute(owner, { mutedUserId: member });
      await setMute(owner, { placeId: schoolId, mutedUserId: null });
      await addMember(joiner);
      await seedArrivals([
        { id: "member-home", userId: member, placeId: homeId },
        { id: "member-school", userId: member, placeId: schoolId },
        { id: "joiner-home", userId: joiner, placeId: homeId },
        { id: "joiner-school", userId: joiner, placeId: schoolId },
      ]);

      expect(await alertIds(owner)).toEqual(["joiner-home"]);
      expect(await alertIds(member)).toEqual(["joiner-home", "joiner-school"]);
    });

    test("unmuting does not bring back arrivals that came in while muted", async () => {
      await setMute(owner, { mutedUserId: member });
      await seedArrivals([{ id: "muted-home", userId: member, placeId: homeId }]);
      const start = encodePlaceAlertsCursor({
        createdAt: new Date(Date.now() - 10 * minute),
        id: "",
      });
      const whileMuted = await pollAlerts(owner, start);
      expect(whileMuted.placeAlerts?.alerts).toEqual([]);

      await setMute(owner, { mutedUserId: member, muted: false });
      const afterUnmute = await pollAlerts(owner, whileMuted.placeAlerts?.cursor ?? start);
      expect(afterUnmute.placeAlerts?.alerts).toEqual([]);
    });

    test("with place alerts switched off none are returned, the cursor still moves on, and switching back on doesn't bring them back", async () => {
      await caller(owner).notificationSettings.set({
        type: "PLACE_ALERTS",
        channel: "phone",
        enabled: false,
      });
      await addMember(joiner);
      await seedArrivals([{ id: "while-off", userId: member, placeId: homeId }]);
      const start = encodePlaceAlertsCursor({
        createdAt: new Date(Date.now() - 10 * minute),
        id: "",
      });

      const whileOff = await pollAlerts(owner, start);
      expect(whileOff.placeAlerts?.alerts).toEqual([]);
      expect(whileOff.placeAlerts?.cursor).not.toBe(start);
      expect(await alertIds(joiner)).toEqual(["while-off"]);

      await caller(owner).notificationSettings.set({
        type: "PLACE_ALERTS",
        channel: "phone",
        enabled: true,
      });
      const afterOn = await pollAlerts(owner, whileOff.placeAlerts?.cursor ?? start);
      expect(afterOn.placeAlerts?.alerts).toEqual([]);
      expect(await alertIds(owner)).toEqual(["while-off"]);
    });

    test("leaving through the app clears the leaver's mutes and the mutes about them", async () => {
      await addMember(leaver);
      await setMute(owner, { mutedUserId: leaver });
      await setMute(owner, { placeId: schoolId, mutedUserId: null });
      await setMute(leaver, { mutedUserId: owner });
      await setMute(leaver, { placeId: schoolId, mutedUserId: null });
      await setMute(member, { mutedUserId: owner });
      await setMute(member, { mutedUserId: leaver });
      const leaving = await prisma.groupMember.findUniqueOrThrow({
        where: { userId_groupId: { userId: leaver, groupId } },
      });
      const epochId = crypto.randomUUID();

      await caller(leaver).groupMembership.remove({
        groupId,
        memberId: leaving.id,
        nextEpoch: {
          createdByDeviceId: phoneOf(leaver),
          epochId,
          epochNumber: 2,
          historyKeys: [],
          recipientKeys: [
            {
              algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
              createdAt: new Date(),
              ephemeralPublicKey: Buffer.alloc(32).toString("base64"),
              epochId,
              recipientDeviceId: phoneOf(owner),
              senderPublicKey: Buffer.alloc(32).toString("base64"),
              wrappedKey: Buffer.alloc(48).toString("base64"),
            },
          ],
        },
      });

      expect(await mutesOf(owner)).toEqual([{ placeId: schoolId, mutedUserId: null }]);
      expect(await mutesOf(member)).toEqual([{ placeId: homeId, mutedUserId: owner }]);
      expect(
        await prisma.placeAlertMute.count({
          where: { OR: [{ muterUserId: leaver }, { mutedUserId: leaver }] },
        }),
      ).toBe(0);
    });

    test("removal and account deletion clear the mutes a person set and the mutes about them", async () => {
      await addMember(leaver);
      await addMember(joiner);
      await setMute(owner, { mutedUserId: leaver });
      await setMute(owner, { mutedUserId: joiner });
      await setMute(leaver, { mutedUserId: owner });
      await setMute(leaver, { placeId: schoolId, mutedUserId: null });
      await setMute(member, { mutedUserId: owner });
      await setMute(member, { mutedUserId: leaver });
      await setMute(member, { mutedUserId: joiner });

      await removeMember(leaver);
      expect(await mutesOf(owner)).toEqual([{ placeId: homeId, mutedUserId: joiner }]);
      expect((await mutesOf(member)).map(({ mutedUserId }) => mutedUserId).sort()).toEqual(
        [joiner, owner].sort(),
      );
      expect(await prisma.placeAlertMute.count({ where: { muterUserId: leaver } })).toBe(0);

      await setMute(joiner, { mutedUserId: owner });
      await expect(
        deleteAccountRecords({
          db: prisma,
          userId: joiner,
          imageUrlPrefix: "https://cdn.example/bucket",
          mode: "immediate",
          securityAlerts: null,
        }),
      ).resolves.toBe(true);
      expect(await mutesOf(owner)).toEqual([]);
      expect(await mutesOf(member)).toEqual([{ placeId: homeId, mutedUserId: owner }]);
      expect(
        await prisma.placeAlertMute.count({
          where: { OR: [{ muterUserId: joiner }, { mutedUserId: joiner }] },
        }),
      ).toBe(0);
    });

    test("deleting a place deletes its mutes", async () => {
      const tempId = `${prefix}-temp`;
      await prisma.place.create({
        data: {
          id: tempId,
          groupId,
          name: "Temp",
          emoji: "🏠",
          epochId: `${groupId}-epoch`,
          senderDeviceId: phoneOf(owner),
          algorithm: "XChaCha20-Poly1305",
          nonce: "nonce",
          ciphertext: "temp-ciphertext",
          createdByUserId: owner,
        },
      });
      await setMute(owner, { placeId: tempId, mutedUserId: null });
      await prisma.place.delete({ where: { id: tempId } });
      expect(await mutesOf(owner)).toEqual([]);
    });
  },
);
