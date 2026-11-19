import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { GroupRole, prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
  encryptGroupPayload,
  PLACE_GEOMETRY_KIND,
} from "@openbeacon/encryption";
import { beginAccountDeletion } from "../../lib/account-deletion.ts";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { encryptedTrackingPoint, testClientPointId } from "../../lib/trackingPoints.testUtil.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupInvitesRouter } from "../group/groupInvitesRouter.ts";
import { groupLifecycleRouter } from "../group/groupLifecycleRouter.ts";
import { groupMembershipRouter } from "../group/groupMembershipRouter.ts";
import { groupPlacesRouter } from "../group/groupPlacesRouter.ts";
import { groupSettingsRouter } from "../group/groupSettingsRouter.ts";
import { groupTrackingRouter } from "../group/groupTrackingRouter.ts";
import { placeAlertsRouter } from "../group/placeAlertsRouter.ts";
import { placeSharingRouter } from "../group/placeSharingRouter.ts";

const router = createTRPCRouter({
  groupInvites: groupInvitesRouter,
  groupLifecycle: groupLifecycleRouter,
  groupMembership: groupMembershipRouter,
  groupPlaces: groupPlacesRouter,
  groupSettings: groupSettingsRouter,
  groupTracking: groupTrackingRouter,
  placeAlerts: placeAlertsRouter,
  placeSharing: placeSharingRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `adv-rc-${crypto.randomUUID()}`;
const names = ["owner", "coOwner", "admin", "admin2", "member", "member2", "outsider"] as const;
const users = Object.fromEntries(names.map((name) => [name, `${prefix}-${name}`])) as Record<
  (typeof names)[number],
  string
>;
const userIds = Object.values(users);
const keys = new Map(userIds.map((userId) => [userId, createDeviceKeyPair()]));
const deviceOf = (userId: string) => `${userId}-device`;
const emailOf = (userId: string) => `${userId}@example.test`;
const groupId = `${prefix}-group`;
const raceGroupId = `${prefix}-race`;
const rejoinGroupId = `${prefix}-rejoin`;
const transferGroupId = `${prefix}-transfer`;
const outsiderGroupId = `${prefix}-outsider-group`;
const groupIds = [groupId, raceGroupId, rejoinGroupId, transferGroupId, outsiderGroupId];
const epochs = new Map<string, ReturnType<typeof createInitialGroupEpoch>>();

const caller = (userId: string) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId: deviceOf(userId),
      unverifiedDeviceId: null,
      session: { user: { id: userId }, session: { id: `${userId}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );

const bundle = (result: ReturnType<typeof createInitialGroupEpoch>) => ({
  createdByDeviceId: result.epoch.createdByDeviceId,
  epochId: result.epoch.epochId,
  epochNumber: result.epoch.epochNumber,
  historyKeys: [],
  recipientKeys: result.wrappedKeys,
});

const initialEpoch = (targetGroupId: string) => epochs.get(targetGroupId)!;

const createGroup = async (targetGroupId: string, creator = users.owner) => {
  const device = await prisma.userDevice.findUniqueOrThrow({
    where: { id: deviceOf(creator) },
  });
  const initial = createInitialGroupEpoch({
    creator: { deviceId: device.id, privateKey: keys.get(creator)!.privateKey },
    groupId: targetGroupId,
    recipients: [
      {
        algorithm: "X25519",
        createdAt: device.createdAt,
        deviceId: device.id,
        publicKey: device.publicKey,
        revokedAt: device.revokedAt,
        userId: device.userId,
      },
    ],
  });
  epochs.set(targetGroupId, initial);
  await caller(creator).groupLifecycle.create({
    groupId: targetGroupId,
    name: "Family",
    initialEpoch: bundle(initial),
  });
};

const addMember = (targetGroupId: string, userId: string, role: GroupRole) =>
  prisma.groupMember.create({
    data: { groupId: targetGroupId, userId, role, joinedEpochNumber: 1 },
  });

const membership = (targetGroupId: string, userId: string) =>
  prisma.groupMember.findUnique({ where: { userId_groupId: { userId, groupId: targetGroupId } } });

const memberId = async (targetGroupId: string, userId: string) =>
  (await membership(targetGroupId, userId))!.id;

const geometry = (userId: string) => {
  const initial = initialEpoch(groupId);
  const encrypted = encryptGroupPayload({
    epochId: initial.epoch.epochId,
    epochKey: initial.epochKey,
    groupId,
    kind: PLACE_GEOMETRY_KIND,
    payload: new Uint8Array(32).fill(7),
    senderDeviceId: deviceOf(userId),
  });
  return {
    algorithm: encrypted.algorithm,
    ciphertext: encrypted.ciphertext,
    epochId: initial.epoch.epochId,
    kind: PLACE_GEOMETRY_KIND,
    nonce: encrypted.nonce,
    senderDeviceId: deviceOf(userId),
  };
};

const forbidden = { code: "FORBIDDEN" };
const notFound = { code: "NOT_FOUND" };

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "adversarial role and consent checks with PostgreSQL",
  () => {
    beforeAll(async () => {
      for (const userId of userIds) {
        const key = keys.get(userId)!;
        await prisma.user.create({ data: { id: userId, name: userId, email: emailOf(userId) } });
        await prisma.session.create({
          data: {
            id: `${userId}-session`,
            token: `${userId}-token`,
            userId,
            expiresAt: new Date(Date.now() + 600_000),
          },
        });
        await prisma.userDevice.create({
          data: {
            id: deviceOf(userId),
            userId,
            publicKey: key.publicKey,
            publicKeyAlgorithm: key.algorithm,
            name: "Phone",
            icon: "phone",
            activatedAt: new Date(),
          },
        });
      }
      for (const id of [groupId, raceGroupId, rejoinGroupId, transferGroupId])
        await createGroup(id);
      await createGroup(outsiderGroupId, users.outsider);
      await addMember(groupId, users.coOwner, GroupRole.OWNER);
      await addMember(groupId, users.admin, GroupRole.ADMIN);
      await addMember(groupId, users.admin2, GroupRole.ADMIN);
      await addMember(groupId, users.member, GroupRole.MEMBER);
      await addMember(groupId, users.member2, GroupRole.MEMBER);
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    });

    test("a Member cannot do any owner or admin action, including promoting themselves", async () => {
      const member = caller(users.member);
      const place = await caller(users.owner).groupPlaces.create({
        groupId,
        name: "Home",
        emoji: "🏠",
        geometry: geometry(users.owner),
      });
      const { code } = await caller(users.owner).groupInvites.createShared({ groupId });
      const shared = await prisma.groupSharedInvite.findFirstOrThrow({
        where: { groupId, creatorId: users.owner },
      });
      const self = await memberId(groupId, users.member);
      const ownerMember = await memberId(groupId, users.owner);
      const other = await memberId(groupId, users.member2);
      const attempts: Array<[string, () => Promise<unknown>]> = [
        ["rename", () => member.groupSettings.rename({ groupId, name: "Mine" })],
        ["group picture", () => member.groupSettings.requestGroupImageUpload({ groupId })],
        [
          "add place",
          () =>
            member.groupPlaces.create({
              groupId,
              name: "Trap",
              emoji: "📍",
              geometry: geometry(users.member),
            }),
        ],
        [
          "edit place",
          () =>
            member.groupPlaces.update({
              groupId,
              placeId: place.place.id,
              name: "Moved",
              emoji: "📍",
              geometry: geometry(users.member),
              expectedCiphertext: place.place.ciphertext,
            }),
        ],
        ["delete place", () => member.groupPlaces.delete({ groupId, placeId: place.place.id })],
        [
          "email invite",
          () =>
            member.groupInvites.send({
              groupId,
              invites: [{ email: emailOf(users.outsider), role: "MEMBER" }],
            }),
        ],
        ["shared invite", () => member.groupInvites.createShared({ groupId })],
        [
          "shared statuses",
          () => member.groupInvites.sharedStatuses({ groupId, inviteIds: [shared.id] }),
        ],
        [
          "promote self to owner",
          () => member.groupMembership.updateRole({ groupId, memberId: self, role: "OWNER" }),
        ],
        [
          "promote self to admin",
          () => member.groupMembership.updateRole({ groupId, memberId: self, role: "ADMIN" }),
        ],
        [
          "demote the owner",
          () =>
            member.groupMembership.updateRole({ groupId, memberId: ownerMember, role: "MEMBER" }),
        ],
        [
          "remove another member",
          () =>
            member.groupMembership.remove({
              groupId,
              memberId: other,
              nextEpoch: bundle(initialEpoch(groupId)),
            }),
        ],
        [
          "removal context for another member",
          () => member.groupMembership.removalContext({ groupId, memberId: other }),
        ],
        ["delete group", () => member.groupLifecycle.delete({ groupId })],
      ];
      for (const [name, attempt] of attempts) {
        const result = await attempt().then(
          () => "allowed",
          (error: { code?: string }) => error.code,
        );
        expect({ name, result }).toEqual({ name, result: "FORBIDDEN" });
      }
      expect(
        await caller(users.owner).groupInvites.sharedStatuses({ groupId, inviteIds: [shared.id] }),
      ).toEqual([{ id: shared.id, status: "active" }]);
      expect(code).toHaveLength(32);
      expect((await membership(groupId, users.member))?.role).toBe(GroupRole.MEMBER);
      expect((await membership(groupId, users.member2))?.role).toBe(GroupRole.MEMBER);
      expect((await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).name).toBe(
        "Family",
      );
      expect(await prisma.place.count({ where: { groupId } })).toBe(1);
      expect(
        await prisma.groupMemberInvite.count({ where: { groupId, recipientId: users.outsider } }),
      ).toBe(0);
    });

    test("an Admin cannot change roles, invite admins, delete the group, or remove an owner or another admin", async () => {
      const admin = caller(users.admin);
      const self = await memberId(groupId, users.admin);
      const attempts: Array<[string, () => Promise<unknown>]> = [
        [
          "promote self to owner",
          () => admin.groupMembership.updateRole({ groupId, memberId: self, role: "OWNER" }),
        ],
        [
          "promote a member",
          async () =>
            admin.groupMembership.updateRole({
              groupId,
              memberId: await memberId(groupId, users.member),
              role: "ADMIN",
            }),
        ],
        [
          "demote the owner",
          async () =>
            admin.groupMembership.updateRole({
              groupId,
              memberId: await memberId(groupId, users.owner),
              role: "MEMBER",
            }),
        ],
        [
          "remove the owner",
          async () =>
            admin.groupMembership.remove({
              groupId,
              memberId: await memberId(groupId, users.owner),
              nextEpoch: bundle(initialEpoch(groupId)),
            }),
        ],
        [
          "remove another admin",
          async () =>
            admin.groupMembership.remove({
              groupId,
              memberId: await memberId(groupId, users.admin2),
              nextEpoch: bundle(initialEpoch(groupId)),
            }),
        ],
        [
          "leave and hand over ownership",
          async () =>
            admin.groupMembership.remove({
              groupId,
              memberId: self,
              successorMemberId: await memberId(groupId, users.member),
              nextEpoch: bundle(initialEpoch(groupId)),
            }),
        ],
        [
          "invite an admin",
          () =>
            admin.groupInvites.send({
              groupId,
              invites: [{ email: emailOf(users.outsider), role: "ADMIN" }],
            }),
        ],
        ["delete group", () => admin.groupLifecycle.delete({ groupId })],
      ];
      for (const [name, attempt] of attempts) {
        const result = await attempt().then(
          () => "allowed",
          (error: { code?: string }) => error.code,
        );
        expect({ name, result }).toEqual({ name, result: "FORBIDDEN" });
      }
      const roles = await prisma.groupMember.findMany({
        where: { groupId },
        select: { userId: true, role: true },
        orderBy: { userId: "asc" },
      });
      expect(roles).toEqual(
        [
          { userId: users.admin, role: GroupRole.ADMIN },
          { userId: users.admin2, role: GroupRole.ADMIN },
          { userId: users.coOwner, role: GroupRole.OWNER },
          { userId: users.member, role: GroupRole.MEMBER },
          { userId: users.member2, role: GroupRole.MEMBER },
          { userId: users.owner, role: GroupRole.OWNER },
        ].sort((a, b) => (a.userId < b.userId ? -1 : 1)),
      );
      expect(await prisma.groupMemberInvite.count({ where: { groupId } })).toBe(0);
    });

    test("an owner of one group cannot reach another group's members, places or invites by id", async () => {
      const outsider = caller(users.outsider);
      const victim = await memberId(groupId, users.member);
      const place = await prisma.place.findFirstOrThrow({ where: { groupId } });
      const shared = await prisma.groupSharedInvite.findFirstOrThrow({ where: { groupId } });
      const dummyEpoch = bundle(initialEpoch(outsiderGroupId));
      const attempts: Array<[string, () => Promise<unknown>]> = [
        [
          "promote a member of another group",
          () =>
            outsider.groupMembership.updateRole({
              groupId: outsiderGroupId,
              memberId: victim,
              role: "OWNER",
            }),
        ],
        [
          "remove a member of another group",
          () =>
            outsider.groupMembership.remove({
              groupId: outsiderGroupId,
              memberId: victim,
              nextEpoch: dummyEpoch,
            }),
        ],
        [
          "hand ownership to a member of another group",
          async () =>
            outsider.groupMembership.remove({
              groupId: outsiderGroupId,
              memberId: await memberId(outsiderGroupId, users.outsider),
              successorMemberId: victim,
              nextEpoch: dummyEpoch,
            }),
        ],
        [
          "delete another group's place",
          () => outsider.groupPlaces.delete({ groupId: outsiderGroupId, placeId: place.id }),
        ],
        [
          "mute at another group's place",
          () =>
            outsider.placeAlerts.setMute({
              groupId: outsiderGroupId,
              placeId: place.id,
              mutedUserId: null,
              muted: true,
            }),
        ],
      ];
      for (const [name, attempt] of attempts) {
        const result = await attempt().then(
          () => "allowed",
          (error: { code?: string }) => error.code,
        );
        expect({ name, result }).toEqual({ name, result: "NOT_FOUND" });
      }
      expect(
        await outsider.groupInvites.sharedStatuses({
          groupId: outsiderGroupId,
          inviteIds: [shared.id],
        }),
      ).toEqual([]);
      expect((await membership(groupId, users.member))?.role).toBe(GroupRole.MEMBER);
      expect((await membership(outsiderGroupId, users.outsider))?.role).toBe(GroupRole.OWNER);
      expect(await prisma.place.count({ where: { id: place.id } })).toBe(1);
      expect(await prisma.placeAlertMute.count({ where: { muterUserId: users.outsider } })).toBe(0);
    });

    test("an owner cannot change another member's history share, arrivals switch or alert mutes by naming them", async () => {
      const owner = caller(users.owner);
      const place = await prisma.place.findFirstOrThrow({ where: { groupId } });
      const target = {
        userId: users.member,
        memberId: await memberId(groupId, users.member),
        deviceId: deviceOf(users.member),
        muterUserId: users.member,
      };
      const historyInput = { groupId, historyShare: "MAXIMUM" as const, ...target };
      const sharingInput = { groupId, enabled: false, ...target };
      const muteInput = {
        groupId,
        placeId: place.id,
        mutedUserId: users.member2,
        muted: true,
        ...target,
      };

      await owner.groupSettings.setHistoryShare(historyInput);
      await owner.placeSharing.set(sharingInput);
      await owner.placeAlerts.setMute(muteInput);

      expect((await membership(groupId, users.member))?.historyShare).toBeNull();
      expect((await membership(groupId, users.owner))?.historyShare).toBe("MAXIMUM");
      expect(
        await prisma.placeSharing.findMany({
          where: { groupId },
          select: { userId: true, deviceId: true, enabled: true },
        }),
      ).toEqual([{ userId: users.owner, deviceId: deviceOf(users.owner), enabled: false }]);
      expect(
        await prisma.placeAlertMute.findMany({
          where: { groupId },
          select: { muterUserId: true, mutedUserId: true },
        }),
      ).toEqual([{ muterUserId: users.owner, mutedUserId: users.member2 }]);
    });

    test("an email invite only works for its recipient, and never after it is declined or 30 days old", async () => {
      await caller(users.owner).groupInvites.send({
        groupId,
        invites: [{ email: emailOf(users.outsider), role: "ADMIN" }],
      });
      const invite = await prisma.groupMemberInvite.findFirstOrThrow({
        where: { groupId, recipientId: users.outsider },
      });
      const thief = caller(users.member2);
      const dummyEpoch = bundle(initialEpoch(groupId));
      await caller(users.member2).groupMembership.remove({
        groupId,
        memberId: await memberId(groupId, users.member2),
        nextEpoch: dummyEpoch,
      });

      await expect(thief.groupInvites.preview({ inviteId: invite.id })).rejects.toMatchObject(
        notFound,
      );
      await expect(
        thief.groupInvites.acceptanceContext({ inviteId: invite.id }),
      ).rejects.toMatchObject(notFound);
      await expect(
        thief.groupInvites.accept({ inviteId: invite.id, nextEpoch: dummyEpoch }),
      ).rejects.toMatchObject(notFound);
      await expect(thief.groupInvites.decline({ inviteId: invite.id })).rejects.toMatchObject(
        notFound,
      );
      expect(await membership(groupId, users.member2)).toBeNull();
      expect(await prisma.groupMemberInvite.count({ where: { id: invite.id } })).toBe(1);

      await prisma.groupMemberInvite.update({
        where: { id: invite.id },
        data: { createdAt: new Date(Date.now() - 31 * 24 * 60 * 60_000) },
      });
      const outsider = caller(users.outsider);
      await expect(
        outsider.groupInvites.accept({ inviteId: invite.id, nextEpoch: dummyEpoch }),
      ).rejects.toMatchObject(notFound);
      await expect(
        outsider.groupInvites.acceptanceContext({ inviteId: invite.id }),
      ).rejects.toMatchObject(notFound);

      await prisma.groupMemberInvite.update({
        where: { id: invite.id },
        data: { createdAt: new Date() },
      });
      await outsider.groupInvites.decline({ inviteId: invite.id });
      await expect(
        outsider.groupInvites.accept({ inviteId: invite.id, nextEpoch: dummyEpoch }),
      ).rejects.toMatchObject(notFound);
      expect(await membership(groupId, users.outsider)).toBeNull();
    });

    test("a removed member cannot upload, reuse their shared code or accept an email invite consumed by joining", async () => {
      const owner = caller(users.owner);
      const member = caller(users.member);
      await owner.groupInvites.send({
        groupId: rejoinGroupId,
        invites: [{ email: emailOf(users.member), role: "MEMBER" }],
      });
      const emailInvite = await prisma.groupMemberInvite.findFirstOrThrow({
        where: { groupId: rejoinGroupId, recipientId: users.member },
      });
      const { code } = await owner.groupInvites.createShared({ groupId: rejoinGroupId });
      const joinContext = await member.groupInvites.sharedAcceptanceContext({ code });
      const joined = createNextGroupEpoch({
        creator: {
          deviceId: deviceOf(users.member),
          privateKey: keys.get(users.member)!.privateKey,
        },
        previousEpoch: joinContext.latestEpoch!,
        recipients: joinContext.recipients,
      });
      await member.groupInvites.acceptShared({ code, nextEpoch: bundle(joined) });
      const point = () =>
        encryptedTrackingPoint({
          clientPointId: testClientPointId(`${prefix}-${crypto.randomUUID()}`),
          epochId: joined.epoch.epochId,
          epochKey: joined.epochKey,
          groupId: rejoinGroupId,
          senderDeviceId: deviceOf(users.member),
        });
      await member.groupTracking.uploadBatch({ groupId: rejoinGroupId, points: [point()] });

      const target = await memberId(rejoinGroupId, users.member);
      const removal = await owner.groupMembership.removalContext({
        groupId: rejoinGroupId,
        memberId: target,
      });
      const next = createNextGroupEpoch({
        creator: { deviceId: deviceOf(users.owner), privateKey: keys.get(users.owner)!.privateKey },
        previousEpoch: removal.latestEpoch!,
        recipients: removal.recipients,
      });
      await owner.groupMembership.remove({
        groupId: rejoinGroupId,
        memberId: target,
        nextEpoch: bundle(next),
      });

      await expect(
        member.groupTracking.uploadBatch({ groupId: rejoinGroupId, points: [point()] }),
      ).rejects.toMatchObject(forbidden);
      await expect(member.groupTracking.poll({ groupId: rejoinGroupId })).rejects.toMatchObject(
        forbidden,
      );
      await expect(
        member.groupInvites.acceptShared({ code, nextEpoch: bundle(joined) }),
      ).rejects.toMatchObject(notFound);
      await expect(
        member.groupInvites.accept({ inviteId: emailInvite.id, nextEpoch: bundle(joined) }),
      ).rejects.toMatchObject(notFound);
      expect(await membership(rejoinGroupId, users.member)).toBeNull();
      expect(
        await prisma.trackingStream.count({
          where: { groupId: rejoinGroupId, senderUserId: users.member },
        }),
      ).toBe(0);
    });

    test("two owners demoting or removing each other at once always leave an owner", async () => {
      await addMember(raceGroupId, users.coOwner, GroupRole.OWNER);
      await addMember(raceGroupId, users.member2, GroupRole.MEMBER);
      const ownerMember = await memberId(raceGroupId, users.owner);
      const coOwnerMember = await memberId(raceGroupId, users.coOwner);
      const owners = () =>
        prisma.groupMember.count({ where: { groupId: raceGroupId, role: GroupRole.OWNER } });

      await Promise.allSettled([
        caller(users.owner).groupMembership.updateRole({
          groupId: raceGroupId,
          memberId: coOwnerMember,
          role: "MEMBER",
        }),
        caller(users.coOwner).groupMembership.updateRole({
          groupId: raceGroupId,
          memberId: ownerMember,
          role: "MEMBER",
        }),
      ]);
      expect(await owners()).toBe(1);

      await prisma.groupMember.updateMany({
        where: { groupId: raceGroupId, userId: { in: [users.owner, users.coOwner] } },
        data: { role: GroupRole.OWNER },
      });
      const dummyEpoch = bundle(initialEpoch(raceGroupId));
      await Promise.allSettled([
        caller(users.owner).groupMembership.remove({
          groupId: raceGroupId,
          memberId: ownerMember,
          nextEpoch: dummyEpoch,
        }),
        caller(users.coOwner).groupMembership.remove({
          groupId: raceGroupId,
          memberId: coOwnerMember,
          nextEpoch: dummyEpoch,
        }),
      ]);
      expect(await owners()).toBe(1);
      expect(await prisma.groupMember.count({ where: { groupId: raceGroupId } })).toBe(2);
    });

    test("probe: a departing owner can hand ownership to a member who never agreed, which then blocks that member's account deletion until they act in the group", async () => {
      await addMember(transferGroupId, users.member, GroupRole.MEMBER);
      await addMember(transferGroupId, users.member2, GroupRole.MEMBER);
      await caller(users.owner).groupMembership.remove({
        groupId: transferGroupId,
        memberId: await memberId(transferGroupId, users.owner),
        successorMemberId: await memberId(transferGroupId, users.member),
        nextEpoch: bundle(initialEpoch(transferGroupId)),
      });
      expect((await membership(transferGroupId, users.member))?.role).toBe(GroupRole.OWNER);

      await expect(
        prisma.$transaction((tx) =>
          beginAccountDeletion(tx, { userId: users.member, delayHours: 24 }),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await caller(users.member).groupLifecycle.delete({ groupId: transferGroupId });
      expect(await prisma.group.count({ where: { id: transferGroupId } })).toBe(0);
    });
  },
);
