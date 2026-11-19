import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
  generateGroupEpochKey,
  type DeviceKeyPair,
} from "@openbeacon/encryption";
import { activateDevice } from "../../lib/deviceActivation.ts";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { sendSeatGraceWarnings } from "../../lib/seatGraceWarnings.ts";
import { freeSeats, heldSeatDevices, seatsUsed } from "../../lib/seats.ts";
import { encryptedTrackingPoint, testClientPointId } from "../../lib/trackingPoints.testUtil.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { accountNoticesRouter } from "../accountNoticesRouter.ts";
import { accountRouter } from "../accountRouter.ts";
import { groupHistoryRouter } from "./groupHistoryRouter.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";
import { groupOwnershipRouter } from "./groupOwnershipRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";
import { placeTransitionsRouter } from "./placeTransitionsRouter.ts";

const router = createTRPCRouter({
  account: accountRouter,
  accountNotices: accountNoticesRouter,
  groupHistory: groupHistoryRouter,
  groupInvites: groupInvitesRouter,
  groupLifecycle: groupLifecycleRouter,
  groupMembership: groupMembershipRouter,
  groupOwnership: groupOwnershipRouter,
  groupTracking: groupTrackingRouter,
  placeTransitions: placeTransitionsRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `seat-checks-${crypto.randomUUID()}`;
const keys = new Map<string, DeviceKeyPair>();
let userCount = 0;

type TestUser = { id: string; deviceIds: string[] };

const heldDeviceIds = async ({ groupId, selfHosted }: { groupId: string; selfHosted: boolean }) =>
  new Set(
    (await heldSeatDevices({ db: prisma, groupIds: [groupId], selfHosted })).map(
      ({ deviceId }) => deviceId,
    ),
  );

const noFreeSeats = { code: "PRECONDITION_FAILED", cause: { reason: "NO_FREE_SEATS" } };
const groupFull = { code: "PRECONDITION_FAILED", cause: { reason: "GROUP_FULL" } };

const createUser = async ({ phones = 1, seats = 2 }: { phones?: number; seats?: number } = {}) => {
  const id = `${prefix}-user-${userCount++}`;
  await prisma.user.create({
    data: { id, name: `Name ${id}`, email: `${id}@example.test`, seats },
  });
  await prisma.session.create({
    data: {
      id: `${id}-session`,
      token: `${id}-token`,
      userId: id,
      expiresAt: new Date(Date.now() + 600_000),
    },
  });
  const deviceIds = Array.from({ length: phones }, (_, index) => `${id}-device-${index}`);
  for (const deviceId of deviceIds) {
    const key = createDeviceKeyPair();
    keys.set(deviceId, key);
    await prisma.userDevice.create({
      data: {
        id: deviceId,
        userId: id,
        publicKey: key.publicKey,
        publicKeyAlgorithm: key.algorithm,
        name: "Phone",
        icon: "phone",
        activatedAt: new Date(),
      },
    });
  }
  return { id, deviceIds };
};

const caller = (
  user: TestUser,
  {
    allowSelfSetSeats = false,
    deviceId = user.deviceIds[0]!,
    selfHosted = false,
  }: { allowSelfSetSeats?: boolean; deviceId?: string; selfHosted?: boolean } = {},
) =>
  router.createCaller(
    withDeviceActive({
      allowSelfSetSeats,
      cache,
      clientIp: "127.0.0.1",
      db: prisma,
      deviceId,
      selfHosted,
      session: { user: { id: user.id }, session: { id: `${user.id}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );

const bundle = (result: ReturnType<typeof createInitialGroupEpoch>) => ({
  createdByDeviceId: result.epoch.createdByDeviceId,
  epochId: result.epoch.epochId,
  epochNumber: result.epoch.epochNumber,
  historyKeys: [],
  recipientKeys: result.wrappedKeys,
});

const createInput = async (owner: TestUser) => {
  const groupId = `${prefix}-group-${crypto.randomUUID()}`;
  const devices = await prisma.userDevice.findMany({ where: { userId: owner.id } });
  return {
    groupId,
    name: "Family",
    initialEpoch: bundle(
      createInitialGroupEpoch({
        creator: {
          deviceId: owner.deviceIds[0]!,
          privateKey: keys.get(owner.deviceIds[0]!)!.privateKey,
        },
        groupId,
        recipients: devices.map((device) => ({
          algorithm: "X25519",
          createdAt: device.createdAt,
          deviceId: device.id,
          publicKey: device.publicKey,
          revokedAt: device.revokedAt,
          userId: device.userId,
        })),
      }),
    ),
  };
};

const createGroup = async (owner: TestUser, options: { selfHosted?: boolean } = {}) => {
  const input = await createInput(owner);
  await caller(owner, options).groupLifecycle.create(input);
  return input.groupId;
};

const joinWithCode = async (
  joiner: TestUser,
  code: string,
  options: { selfHosted?: boolean } = {},
) => {
  const context = await caller(joiner, options).groupInvites.sharedAcceptanceContext({ code });
  const nextEpoch = bundle(
    createNextGroupEpoch({
      creator: {
        deviceId: joiner.deviceIds[0]!,
        privateKey: keys.get(joiner.deviceIds[0]!)!.privateKey,
      },
      previousEpoch: context.latestEpoch!,
      recipients: context.recipients,
    }),
  );
  return caller(joiner, options).groupInvites.acceptShared({ code, nextEpoch });
};

const invite = async (owner: TestUser, groupId: string, options: { selfHosted?: boolean } = {}) =>
  (await caller(owner, options).groupInvites.createShared({ groupId })).code;

const addMembers = async (groupId: string, count: number) => {
  const ids = Array.from({ length: count }, () => `${prefix}-filler-${crypto.randomUUID()}`);
  await prisma.user.createMany({
    data: ids.map((id) => ({ id, name: id, email: `${id}@example.test` })),
  });
  await prisma.userDevice.createMany({
    data: ids.map((id) => ({
      id: `${id}-device`,
      userId: id,
      publicKey: createDeviceKeyPair().publicKey,
      publicKeyAlgorithm: "X25519",
      name: "Phone",
      icon: "phone" as const,
      activatedAt: new Date(),
    })),
  });
  await prisma.groupMember.createMany({
    data: ids.map((userId) => ({ groupId, userId, role: "MEMBER" as const, joinedEpochNumber: 1 })),
  });
};

const leave = async (member: TestUser, groupId: string) => {
  const membership = await prisma.groupMember.findUniqueOrThrow({
    where: { userId_groupId: { userId: member.id, groupId } },
  });
  const context = await caller(member).groupMembership.removalContext({
    groupId,
    memberId: membership.id,
  });
  const nextEpoch = bundle(
    createNextGroupEpoch({
      creator: {
        deviceId: member.deviceIds[0]!,
        privateKey: keys.get(member.deviceIds[0]!)!.privateKey,
      },
      previousEpoch: context.latestEpoch!,
      recipients: context.recipients,
    }),
  );
  await caller(member).groupMembership.remove({ groupId, memberId: membership.id, nextEpoch });
};

const upload = async (sender: TestUser, groupId: string, seed: string) => {
  const epoch = await prisma.groupEpoch.findFirstOrThrow({
    where: { groupId },
    orderBy: { epochNumber: "desc" },
  });
  const clientPointId = testClientPointId(seed);
  const result = await caller(sender).groupTracking.uploadBatch({
    groupId,
    points: [
      encryptedTrackingPoint({
        clientPointId,
        epochId: epoch.id,
        epochKey: generateGroupEpochKey(),
        groupId,
        senderDeviceId: sender.deviceIds[0]!,
      }),
    ],
  });
  return { clientPointId, result };
};

const setSeats = (user: TestUser, seats: number) =>
  prisma.user.update({ where: { id: user.id }, data: { seats } });

const onHold = { code: "FORBIDDEN", cause: { reason: "SEAT_ON_HOLD" } };

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "seat checks with PostgreSQL",
  () => {
    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.$disconnect();
    });

    test("an account with no seats, or too few for its phones, can't create a group", async () => {
      const noSeats = await createUser({ seats: 0 });
      await expect(
        caller(noSeats).groupLifecycle.create(await createInput(noSeats)),
      ).rejects.toMatchObject({
        ...noFreeSeats,
        message: "Your account has no seats. Add seats to create a group.",
      });

      const twoPhones = await createUser({ phones: 2, seats: 1 });
      await expect(
        caller(twoPhones).groupLifecycle.create(await createInput(twoPhones)),
      ).rejects.toMatchObject({
        ...noFreeSeats,
        message:
          "Creating a group needs 2 seats, one for each of your phones, and you have 1 free seat.",
      });
      expect(
        await prisma.group.count({ where: { ownerId: { in: [noSeats.id, twoPhones.id] } } }),
      ).toBe(0);
    });

    test("an owner with 2 seats and one phone can invite one person, then can't create another invite", async () => {
      const owner = await createUser({ seats: 2 });
      const editor = await createUser();
      const joiner = await createUser();
      const groupId = await createGroup(owner);
      expect(await caller(owner).groupInvites.seats({ groupId })).toEqual({
        blockedBy: null,
        message: null,
      });

      await joinWithCode(joiner, await invite(owner, groupId));
      expect(await seatsUsed(prisma, owner.id)).toBe(2);

      await expect(caller(owner).groupInvites.createShared({ groupId })).rejects.toMatchObject({
        ...noFreeSeats,
        message:
          "You're using all 2 of your seats. Add seats or remove someone to invite more people.",
      });
      await expect(
        caller(owner).groupInvites.send({
          groupId,
          invites: [{ email: `${editor.id}@example.test`, role: "MEMBER" }],
        }),
      ).rejects.toMatchObject(noFreeSeats);
      expect(await caller(owner).groupInvites.seats({ groupId })).toEqual({
        blockedBy: "NO_FREE_SEATS",
        message:
          "You're using all 2 of your seats. Add seats or remove someone to invite more people.",
      });

      await prisma.groupMember.create({
        data: { groupId, userId: editor.id, role: "EDITOR", joinedEpochNumber: 1 },
      });
      await prisma.user.update({ where: { id: owner.id }, data: { seats: 4 } });
      await caller(editor).groupInvites.createShared({ groupId });
      await prisma.user.update({ where: { id: owner.id }, data: { seats: 3 } });
      const noRoom = `Name ${owner.id} owns this group and has no free seats. Ask Name ${owner.id} to add seats or to remove someone.`;
      await expect(caller(editor).groupInvites.createShared({ groupId })).rejects.toMatchObject({
        ...noFreeSeats,
        message: noRoom,
      });
      await prisma.user.update({ where: { id: owner.id }, data: { seats: 2 } });
      await expect(caller(editor).groupInvites.createShared({ groupId })).rejects.toMatchObject({
        message: noRoom,
      });
      expect(await caller(editor).groupInvites.seats({ groupId })).toEqual({
        blockedBy: "NO_FREE_SEATS",
        message: noRoom,
      });
      expect(await caller(owner).groupInvites.seats({ groupId })).toEqual({
        blockedBy: "NO_FREE_SEATS",
        message:
          "You're using 3 seats but have 2. Add seats or remove someone to invite more people.",
      });
    });

    test("a joiner with two phones can't join with only one free seat, and is told before trying", async () => {
      const owner = await createUser({ seats: 2 });
      const joiner = await createUser({ phones: 2 });
      const groupId = await createGroup(owner);
      const code = await invite(owner, groupId);

      expect(await caller(joiner).groupInvites.sharedPreview({ code })).toMatchObject({
        owner: { name: `Name ${owner.id}` },
        seats: { needed: 2, perGroup: 64 },
        joinBlockedBy: "NO_FREE_SEATS",
      });
      expect(await caller(joiner).groupInvites.sharedPreview({ code })).not.toHaveProperty(
        "seats.free",
      );
      await expect(joinWithCode(joiner, code)).rejects.toMatchObject({
        ...noFreeSeats,
        message: `This group has no free seats for your phones. Ask Name ${owner.id} to add seats.`,
      });

      const emailInvite = await prisma.groupMemberInvite.create({
        data: { groupId, inviterId: owner.id, recipientId: joiner.id, role: "MEMBER" },
      });
      expect(await caller(joiner).groupInvites.preview({ inviteId: emailInvite.id })).toMatchObject(
        {
          joinBlockedBy: "NO_FREE_SEATS",
        },
      );
      const context = await caller(joiner).groupInvites.acceptanceContext({
        inviteId: emailInvite.id,
      });
      await expect(
        caller(joiner).groupInvites.accept({
          inviteId: emailInvite.id,
          nextEpoch: bundle(
            createNextGroupEpoch({
              creator: {
                deviceId: joiner.deviceIds[0]!,
                privateKey: keys.get(joiner.deviceIds[0]!)!.privateKey,
              },
              previousEpoch: context.latestEpoch!,
              recipients: context.recipients,
            }),
          ),
        }),
      ).rejects.toMatchObject(noFreeSeats);
      expect(await prisma.groupMember.count({ where: { groupId } })).toBe(1);
    });

    test("two joins into different groups racing for the owner's last seat let exactly one in", async () => {
      const owner = await createUser({ seats: 3 });
      const [first, second] = [await createUser(), await createUser()];
      const firstGroup = await createGroup(owner);
      const secondGroup = await createGroup(owner);
      const [firstCode, secondCode] = [
        await invite(owner, firstGroup),
        await invite(owner, secondGroup),
      ];

      const results = await Promise.allSettled([
        joinWithCode(first, firstCode),
        joinWithCode(second, secondCode),
      ]);

      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toMatchObject(noFreeSeats);
      expect(await seatsUsed(prisma, owner.id)).toBe(3);
    });

    test("a member in two of the owner's groups uses two seats", async () => {
      const owner = await createUser({ seats: 4 });
      const member = await createUser();
      for (const groupId of [await createGroup(owner), await createGroup(owner)]) {
        await joinWithCode(member, await invite(owner, groupId));
      }
      expect((await caller(owner).account.usage()).seats).toMatchObject({ seats: 4, used: 4 });
    });

    test("a 65th seat in a group is refused, on hosted and self-hosted servers", async () => {
      const owner = await createUser({ seats: 1_024 });
      const joiner = await createUser();
      const groupId = await createGroup(owner);
      await addMembers(groupId, 62);
      const code = await invite(owner, groupId);
      await addMembers(groupId, 1);

      expect(await caller(joiner).groupInvites.sharedPreview({ code })).toMatchObject({
        joinBlockedBy: "GROUP_FULL",
      });
      for (const selfHosted of [false, true]) {
        await expect(joinWithCode(joiner, code, { selfHosted })).rejects.toMatchObject(groupFull);
        await expect(
          caller(owner, { selfHosted }).groupInvites.createShared({ groupId }),
        ).rejects.toMatchObject(groupFull);
      }
      expect(await caller(owner).groupInvites.seats({ groupId })).toEqual({
        blockedBy: "GROUP_FULL",
        message: "This group is full. A group can have up to 64 phones.",
      });
    });

    test("activating a third device puts it on hold in a group whose owner is full", async () => {
      const owner = await createUser({ seats: 2 });
      const member = await createUser();
      const groupId = await createGroup(owner);
      await joinWithCode(member, await invite(owner, groupId));
      const newDeviceId = `${member.id}-device-new`;
      const key = createDeviceKeyPair();
      keys.set(newDeviceId, key);
      await prisma.userDevice.create({
        data: {
          id: newDeviceId,
          userId: member.id,
          publicKey: key.publicKey,
          publicKeyAlgorithm: key.algorithm,
          name: "Tablet",
          icon: "tablet",
        },
      });

      await prisma.$transaction((tx) =>
        activateDevice({ activatedBy: "phrase", db: tx, deviceId: newDeviceId, userId: member.id }),
      );

      expect(await heldDeviceIds({ groupId, selfHosted: false })).toEqual(new Set([newDeviceId]));
      expect(await heldDeviceIds({ groupId, selfHosted: true })).toEqual(new Set());
      await expect(
        caller(member, { deviceId: newDeviceId }).groupTracking.getLatest({ groupId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", cause: { reason: "SEAT_ON_HOLD" } });
      await caller(member).groupTracking.getLatest({ groupId });

      const epoch = await prisma.groupEpoch.findFirstOrThrow({
        where: { groupId },
        orderBy: { epochNumber: "desc" },
      });
      const clientPointId = testClientPointId("held");
      const uploaded = await caller(member, { deviceId: newDeviceId }).groupTracking.uploadBatch({
        groupId,
        points: [
          encryptedTrackingPoint({
            clientPointId,
            epochId: epoch.id,
            epochKey: generateGroupEpochKey(),
            groupId,
            senderDeviceId: newDeviceId,
          }),
        ],
      });
      expect(uploaded).toMatchObject({ accepted: [], discarded: [clientPointId] });

      await prisma.user.update({ where: { id: owner.id }, data: { seats: 3 } });
      expect(await heldDeviceIds({ groupId, selfHosted: false })).toEqual(new Set());
    });

    test("taking over a group needs a free seat for every seat in it", async () => {
      const owner = await createUser({ seats: 2 });
      const admin = await createUser({ seats: 1 });
      const groupId = await createGroup(owner);
      await joinWithCode(admin, await invite(owner, groupId));
      const membership = await prisma.groupMember.update({
        where: { userId_groupId: { userId: admin.id, groupId } },
        data: { role: "ADMIN" },
      });
      await caller(owner).groupOwnership.offer({ groupId, memberId: membership.id });
      expect((await caller(admin).groupOwnership.offers())[0]?.seats).toBe(2);

      await expect(caller(admin).groupOwnership.accept({ groupId })).rejects.toMatchObject({
        ...noFreeSeats,
        message: "Taking over this group needs 2 seats and you have 1 free seat. Add seats first.",
      });
      await prisma.user.update({ where: { id: admin.id }, data: { seats: 2 } });
      await caller(admin).groupOwnership.accept({ groupId });
      expect((await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).ownerId).toBe(
        admin.id,
      );
    });

    test("setSeats only works while the server allows it, within 0 to 1,024", async () => {
      const user = await createUser();
      const forbidden = { code: "FORBIDDEN" };
      await expect(caller(user).account.setSeats({ seats: 5 })).rejects.toMatchObject(forbidden);
      await expect(
        caller(user, { allowSelfSetSeats: true, selfHosted: true }).account.setSeats({ seats: 5 }),
      ).rejects.toMatchObject(forbidden);
      expect((await caller(user).account.usage()).seats).toMatchObject({
        selfSetAllowed: false,
        seats: 2,
      });

      const allowed = caller(user, { allowSelfSetSeats: true });
      expect((await allowed.account.usage()).seats).toMatchObject({
        selfSetAllowed: true,
        max: 1_024,
      });
      await expect(allowed.account.setSeats({ seats: 1_025 })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(await allowed.account.setSeats({ seats: 1_024 })).toEqual({ seats: 1_024 });
      expect(await allowed.account.setSeats({ seats: 0 })).toEqual({ seats: 0 });
    });

    test("self-hosted servers skip every seat check", async () => {
      const selfHosted = { selfHosted: true };
      const owner = await createUser({ seats: 0 });
      const joiner = await createUser({ phones: 2, seats: 0 });
      const groupId = await createGroup(owner, selfHosted);
      const code = await invite(owner, groupId, selfHosted);
      expect(await caller(joiner, selfHosted).groupInvites.sharedPreview({ code })).toMatchObject({
        seats: { needed: 2, perGroup: 64 },
        joinBlockedBy: null,
      });
      await joinWithCode(joiner, code, selfHosted);
      expect(await caller(owner, selfHosted).groupInvites.seats({ groupId })).toEqual({
        blockedBy: null,
        message: null,
      });
      expect(await caller(owner, selfHosted).account.seats()).toEqual({ grace: null });
      expect((await caller(owner, selfHosted).account.usage()).seats).toBeNull();
      expect(await heldDeviceIds({ groupId, selfHosted: true })).toEqual(new Set());

      const membership = await prisma.groupMember.update({
        where: { userId_groupId: { userId: joiner.id, groupId } },
        data: { role: "ADMIN" },
      });
      await caller(owner, selfHosted).groupOwnership.offer({ groupId, memberId: membership.id });
      expect((await caller(joiner, selfHosted).groupOwnership.offers())[0]?.seats).toBeNull();
      await caller(joiner, selfHosted).groupOwnership.accept({ groupId });
    });

    test("holds follow seat order across an owner's groups and lift when seats are added, someone leaves or a phone is removed", async () => {
      const owner = await createUser({ seats: 5 });
      const [first, second, third] = [await createUser(), await createUser(), await createUser()];
      const family = await createGroup(owner);
      const friends = await createGroup(owner);
      await joinWithCode(first, await invite(owner, family));
      await joinWithCode(second, await invite(owner, friends));
      await joinWithCode(third, await invite(owner, family));
      const held = async () =>
        (await heldSeatDevices({ db: prisma, groupIds: [family, friends], selfHosted: false }))
          .map(({ deviceId }) => deviceId)
          .toSorted();
      expect(await held()).toEqual([]);

      await setSeats(owner, 3);
      expect(await held()).toEqual([second.deviceIds[0], third.deviceIds[0]].toSorted());
      expect(
        (await caller(third).groupMembership.list()).find(({ id }) => id === family)?.onHold,
      ).toBe(true);
      expect(
        (await caller(first).groupMembership.list()).find(({ id }) => id === family)?.onHold,
      ).toBe(false);
      expect(await caller(second).accountNotices.sync({ cursor: null })).toMatchObject({
        heldGroupIds: [friends],
      });

      await setSeats(owner, 4);
      expect(await held()).toEqual([third.deviceIds[0]]);

      await leave(first, family);
      expect(await held()).toEqual([]);

      await setSeats(owner, 3);
      expect(await held()).toEqual([third.deviceIds[0]]);
      await prisma.userDevice.update({
        where: { id: second.deviceIds[0]! },
        data: { revokedAt: new Date() },
      });
      expect(await held()).toEqual([]);
    });

    test("a held phone can't upload to or read that group, but still shares in its other groups and can leave", async () => {
      const owner = await createUser({ seats: 2 });
      const otherOwner = await createUser({ seats: 4 });
      const member = await createUser();
      const family = await createGroup(owner);
      const friends = await createGroup(otherOwner);
      await joinWithCode(member, await invite(owner, family));
      await joinWithCode(member, await invite(otherOwner, friends));
      await upload(member, family, "before-hold");
      await setSeats(owner, 1);

      const held = await upload(member, family, "held");
      expect(held.result).toMatchObject({ accepted: [], discarded: [held.clientPointId] });
      const member_ = caller(member);
      for (const read of [
        () => member_.groupTracking.poll({ groupId: family }),
        () => member_.groupTracking.getLatest({ groupId: family }),
        () => member_.groupTracking.historyDays({ groupId: family }),
        () => member_.groupTracking.historyRange({ groupId: family, fromHour: 0, toHour: 1 }),
        () => member_.groupHistory.list({ groupId: family }),
        () => member_.placeTransitions.recent({ groupId: family }),
      ]) {
        await expect(read()).rejects.toMatchObject(onHold);
      }

      await prisma.groupEvent.create({
        data: { groupId: family, type: "GROUP_RENAMED", actorUserId: owner.id, name: "Family" },
      });
      await prisma.groupEvent.create({
        data: {
          groupId: friends,
          type: "GROUP_RENAMED",
          actorUserId: otherOwner.id,
          name: "Friends",
        },
      });
      expect((await member_.groupHistory.latest()).map(({ groupId }) => groupId)).toEqual([
        friends,
      ]);

      const shared = await upload(member, friends, "shared");
      expect(shared.result).toMatchObject({ accepted: [shared.clientPointId] });
      await member_.groupTracking.getLatest({ groupId: friends });

      const ownerView = await caller(owner).groupTracking.getLatest({ groupId: family });
      expect(ownerView.sharing.find(({ deviceId }) => deviceId === member.deviceIds[0])).toEqual(
        expect.objectContaining({ onHold: true, paused: false }),
      );
      expect(
        ownerView.points.some(({ senderDeviceId }) => senderDeviceId === member.deviceIds[0]),
      ).toBe(false);
      expect(
        (await member_.groupMembership.list())
          .map(({ id, onHold }) => ({ id, onHold }))
          .toSorted((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(
        [
          { id: family, onHold: true },
          { id: friends, onHold: false },
        ].toSorted((a, b) => a.id.localeCompare(b.id)),
      );

      await leave(member, family);
      expect(
        await prisma.groupMember.count({ where: { groupId: family, userId: member.id } }),
      ).toBe(0);
    });

    test("a pause survives a hold lifting", async () => {
      const owner = await createUser({ seats: 2 });
      const member = await createUser();
      const groupId = await createGroup(owner);
      await joinWithCode(member, await invite(owner, groupId));
      await prisma.user.update({ where: { id: member.id }, data: { sharingPaused: true } });
      await setSeats(owner, 1);
      const memberState = async () =>
        (await caller(owner).groupTracking.getLatest({ groupId })).sharing.find(
          ({ deviceId }) => deviceId === member.deviceIds[0],
        );
      expect(await memberState()).toMatchObject({ paused: true, onHold: true });

      await setSeats(owner, 2);
      expect(await memberState()).toMatchObject({ paused: true, onHold: false });
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).sharingPaused,
      ).toBe(true);
    });

    test("a paid period ending gives 7 days' grace with warnings, then puts the seats on hold", async () => {
      const owner = await createUser({ seats: 2 });
      const member = await createUser();
      const groupId = await createGroup(owner);
      await joinWithCode(member, await invite(owner, groupId));
      const endedAt = new Date(Date.now() - 3_600_000);
      await prisma.user.update({ where: { id: owner.id }, data: { paidPeriodEndsAt: endedAt } });
      const graceEndsAt = new Date(endedAt.getTime() + 7 * 86_400_000);

      const seats = await caller(owner).account.seats();
      expect((await caller(owner).account.usage()).seats).toMatchObject({
        seats: 2,
        paidPeriodEndsAt: endedAt,
      });
      expect(seats.grace?.endsAt).toEqual(graceEndsAt);
      expect(seats.grace?.holds.map(({ deviceId }) => deviceId).toSorted()).toEqual(
        [owner.deviceIds[0], member.deviceIds[0]].toSorted(),
      );
      expect(await heldDeviceIds({ groupId, selfHosted: false })).toEqual(new Set());

      const emails: Array<{ kind: string; to: string; holds: unknown[] }> = [];
      const warn = (now: Date) =>
        sendSeatGraceWarnings({
          db: prisma,
          now,
          sendEmail: async (email) => {
            if (email.userId === owner.id) emails.push(email);
          },
        });
      const notices = () =>
        prisma.accountNotice.findMany({
          where: { userId: { in: [owner.id, member.id] } },
          select: { userId: true, type: true, groupId: true, holdsFrom: true },
          orderBy: [{ createdAt: "asc" }, { type: "asc" }],
        });
      await warn(new Date());
      await warn(new Date());
      expect(await notices()).toEqual([
        { userId: owner.id, type: "SEATS_ENDING", groupId: null, holdsFrom: graceEndsAt },
        { userId: member.id, type: "SEAT_HOLD_COMING", groupId, holdsFrom: graceEndsAt },
      ]);
      expect(emails).toMatchObject([{ kind: "ending", to: `${owner.id}@example.test` }]);
      expect(emails[0]?.holds).toHaveLength(2);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).lastGracePeriodStartedAt,
      ).toEqual(endedAt);

      const dayBeforeEnd = new Date(graceEndsAt.getTime() - 12 * 3_600_000);
      await warn(dayBeforeEnd);
      await warn(dayBeforeEnd);
      expect((await notices()).map(({ type }) => type)).toEqual([
        "SEATS_ENDING",
        "SEAT_HOLD_COMING",
        "SEATS_ENDING_SOON",
      ]);
      expect(emails.map(({ kind }) => kind)).toEqual(["ending", "reminder"]);

      await prisma.user.update({
        where: { id: owner.id },
        data: { paidPeriodEndsAt: new Date(Date.now() - 8 * 86_400_000) },
      });
      expect(await heldDeviceIds({ groupId, selfHosted: false })).toEqual(
        new Set([owner.deviceIds[0], member.deviceIds[0]]),
      );
      expect(await caller(owner).account.seats()).toEqual({ grace: null });
      expect((await caller(owner).account.usage()).seats?.seats).toBe(0);
    });

    test("a first run inside a grace period's last day sends the warning without a reminder", async () => {
      const owner = await createUser({ seats: 2 });
      const member = await createUser();
      const groupId = await createGroup(owner);
      await joinWithCode(member, await invite(owner, groupId));
      await prisma.user.update({
        where: { id: owner.id },
        data: { paidPeriodEndsAt: new Date(Date.now() - 6.5 * 86_400_000) },
      });
      const kinds: string[] = [];
      for (const hoursLater of [0, 1, 2]) {
        await sendSeatGraceWarnings({
          db: prisma,
          now: new Date(Date.now() + hoursLater * 3_600_000),
          sendEmail: async (email) => {
            if (email.userId === owner.id) kinds.push(email.kind);
          },
        });
      }
      expect(
        (await prisma.accountNotice.findMany({ where: { userId: owner.id } })).map(
          ({ type }) => type,
        ),
      ).toEqual(["SEATS_ENDING"]);
      expect(kinds).toEqual(["ending"]);
    });

    test("a seats ending email that fails is sent once on the next run", async () => {
      const owner = await createUser({ seats: 2 });
      const member = await createUser();
      const groupId = await createGroup(owner);
      await joinWithCode(member, await invite(owner, groupId));
      await prisma.user.update({
        where: { id: owner.id },
        data: { paidPeriodEndsAt: new Date(Date.now() - 3_600_000) },
      });
      const kinds: string[] = [];
      let failing = true;
      const warn = () =>
        sendSeatGraceWarnings({
          db: prisma,
          now: new Date(),
          sendEmail: async (email) => {
            if (email.userId !== owner.id) return;
            if (failing) throw new Error("Email provider unavailable");
            kinds.push(email.kind);
          },
        });
      const consoleError = spyOn(console, "error").mockImplementation(() => {});
      await warn();
      consoleError.mockRestore();
      expect(kinds).toEqual([]);
      expect(
        await prisma.accountNotice.findMany({
          where: { userId: owner.id },
          select: { type: true, emailedAt: true },
        }),
      ).toEqual([{ type: "SEATS_ENDING", emailedAt: null }]);

      failing = false;
      await warn();
      await warn();
      expect(kinds).toEqual(["ending"]);
    });

    test("a second grace period within 6 months isn't given, and the owner is told once each time the seats end", async () => {
      const owner = await createUser({ seats: 2 });
      const member = await createUser();
      const groupId = await createGroup(owner);
      await joinWithCode(member, await invite(owner, groupId));
      const endedAt = new Date(Date.now() - 3_600_000);
      await prisma.user.update({
        where: { id: owner.id },
        data: {
          paidPeriodEndsAt: endedAt,
          lastGracePeriodStartedAt: new Date(Date.now() - 60 * 86_400_000),
        },
      });

      expect(await caller(owner).account.seats()).toEqual({ grace: null });
      expect((await caller(owner).account.usage()).seats?.seats).toBe(0);
      const bothPhones = [owner.deviceIds[0], member.deviceIds[0]];
      expect(await heldDeviceIds({ groupId, selfHosted: false })).toEqual(new Set(bothPhones));
      await expect(
        caller(owner).groupLifecycle.create(await createInput(owner)),
      ).rejects.toMatchObject(noFreeSeats);

      const emails: Array<{ kind: string; holdsFrom: Date; holds: Array<{ deviceId: string }> }> =
        [];
      const warn = (now: Date) =>
        sendSeatGraceWarnings({
          db: prisma,
          now,
          sendEmail: async (email) => {
            if (email.userId === owner.id) emails.push(email);
          },
        });
      const notices = () =>
        prisma.accountNotice.findMany({
          where: { userId: { in: [owner.id, member.id] } },
          select: { userId: true, type: true, holdsFrom: true },
        });
      await warn(new Date());
      await warn(new Date());
      expect(await notices()).toEqual([
        { userId: owner.id, type: "SEATS_ENDED", holdsFrom: endedAt },
      ]);
      expect(emails).toMatchObject([{ kind: "ended", holdsFrom: endedAt }]);
      expect(emails[0]?.holds.map(({ deviceId }) => deviceId).toSorted()).toEqual(
        bothPhones.toSorted(),
      );
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).seatsEndedNoticeFor,
      ).toEqual(endedAt);

      await prisma.accountNotice.deleteMany({ where: { userId: owner.id } });
      await warn(new Date(Date.now() + 2 * 86_400_000));
      expect(await notices()).toEqual([]);
      expect(emails).toHaveLength(1);

      await prisma.user.update({
        where: { id: owner.id },
        data: { paidPeriodEndsAt: new Date(Date.now() + 30 * 86_400_000) },
      });
      await warn(new Date());
      expect(await heldDeviceIds({ groupId, selfHosted: false })).toEqual(new Set());
      const endedAgain = new Date(Date.now() - 60_000);
      await prisma.user.update({
        where: { id: owner.id },
        data: { paidPeriodEndsAt: endedAgain },
      });
      await warn(new Date());
      await warn(new Date());
      expect(await notices()).toEqual([
        { userId: owner.id, type: "SEATS_ENDED", holdsFrom: endedAgain },
      ]);
      expect(emails.map(({ kind, holdsFrom }) => ({ kind, holdsFrom }))).toEqual([
        { kind: "ended", holdsFrom: endedAt },
        { kind: "ended", holdsFrom: endedAgain },
      ]);
    });

    test("usage shows seats per owned group in seat order with holds, and no seats for other owners' groups", async () => {
      const owner = await createUser({ seats: 2 });
      const member = await createUser({ phones: 2 });
      const other = await createUser({ seats: 4 });
      const family = await createGroup(owner);
      await setSeats(owner, 3);
      await joinWithCode(member, await invite(owner, family));
      const theirs = await createGroup(other);
      await joinWithCode(owner, await invite(other, theirs));
      await setSeats(owner, 2);
      const usage = await caller(owner, { allowSelfSetSeats: true }).account.usage();
      expect(usage.gauges).toEqual([
        {
          id: "seats",
          label: "Seats",
          used: 3,
          max: 2,
          onHold: 1,
          unit: { one: "seat", other: "seats" },
        },
        {
          id: "groups",
          label: "Groups",
          used: 2,
          max: 16,
          onHold: 0,
          unit: { one: "group", other: "groups" },
        },
      ]);
      expect(usage.limits).toEqual([
        {
          id: "history",
          label: "Location history kept",
          value: 30,
          unit: { one: "day", other: "days" },
        },
      ]);
      expect(usage.seats).toEqual({
        seats: 2,
        paidSeats: 2,
        used: 3,
        onHold: 1,
        max: 1_024,
        selfSetAllowed: true,
        paidPeriodEndsAt: null,
        graceEndsAt: null,
      });
      const [familyUsage, theirsUsage] = usage.groups;
      expect(familyUsage).toMatchObject({ id: family, isOwner: true, yourPhonesOnHold: [] });
      expect(familyUsage?.seats).toMatchObject({ used: 3, max: 64, onHold: 1 });
      expect(
        familyUsage?.seats?.phones.map(({ deviceId, isThisPhone, onHold }) => ({
          deviceId,
          isThisPhone,
          onHold,
        })),
      ).toEqual([
        { deviceId: owner.deviceIds[0], isThisPhone: true, onHold: false },
        { deviceId: member.deviceIds[0], isThisPhone: false, onHold: false },
        { deviceId: member.deviceIds[1], isThisPhone: false, onHold: true },
      ]);
      expect(theirsUsage).toMatchObject({
        id: theirs,
        isOwner: false,
        owner: { userId: other.id },
        seats: null,
        yourPhonesOnHold: [],
      });
      expect((await caller(owner).account.usage()).seats?.selfSetAllowed).toBe(false);

      await setSeats(other, 1);
      expect((await caller(owner).account.usage()).groups[1]?.yourPhonesOnHold).toEqual([
        { deviceId: owner.deviceIds[0], deviceName: "Phone", isThisPhone: true },
      ]);

      await setSeats(owner, 3);
      const endedAt = new Date(Date.now() - 3_600_000);
      await prisma.user.update({ where: { id: owner.id }, data: { paidPeriodEndsAt: endedAt } });
      const grace = await caller(owner).account.usage();
      const graceEndsAt = new Date(endedAt.getTime() + 7 * 86_400_000);
      expect(grace.seats).toMatchObject({ seats: 3, onHold: 0, graceEndsAt });
      expect(grace.groups[0]?.seats?.phones.map(({ holdsFrom }) => holdsFrom)).toEqual([
        graceEndsAt,
        graceEndsAt,
        graceEndsAt,
      ]);
    });

    test("usage on a self-hosted server shows groups only", async () => {
      const owner = await createUser({ seats: 0 });
      const member = await createUser();
      const groupId = await createGroup(owner, { selfHosted: true });
      await joinWithCode(member, await invite(owner, groupId, { selfHosted: true }), {
        selfHosted: true,
      });

      const usage = await caller(owner, {
        allowSelfSetSeats: true,
        selfHosted: true,
      }).account.usage();
      expect(usage.gauges.map(({ id }) => id)).toEqual(["groups"]);
      expect(usage.gauges[0]).toMatchObject({ used: 1, max: 16 });
      expect(usage.seats).toBeNull();
      expect(usage.groups).toEqual([
        {
          id: groupId,
          name: "Family",
          owner: { userId: owner.id, name: `Name ${owner.id}` },
          isOwner: true,
          seats: null,
          yourPhonesOnHold: [],
        },
      ]);
      expect((await caller(member, { selfHosted: true }).account.usage()).groups[0]).toMatchObject({
        isOwner: false,
        seats: null,
      });
    });

    test("the debug setting ends and renews the paid period only where self-set seats are allowed", async () => {
      const owner = await createUser({ seats: 2 });
      await expect(caller(owner).account.setPaidPeriodEnded({ ended: true })).rejects.toMatchObject(
        { code: "FORBIDDEN" },
      );
      await expect(
        caller(owner, { allowSelfSetSeats: true, selfHosted: true }).account.setPaidPeriodEnded({
          ended: true,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const ended = await caller(owner, { allowSelfSetSeats: true }).account.setPaidPeriodEnded({
        ended: true,
      });
      expect(ended.paidPeriodEndsAt).toBeInstanceOf(Date);
      expect((await caller(owner).account.seats()).grace).not.toBeNull();
      await caller(owner, { allowSelfSetSeats: true }).account.setPaidPeriodEnded({ ended: false });
      expect(await caller(owner).account.seats()).toEqual({ grace: null });
      expect((await caller(owner).account.usage()).seats).toMatchObject({
        paidPeriodEndsAt: null,
        seats: 2,
      });
    });

    const graceWarnings = (
      now: Date,
      sendEmail: Parameters<typeof sendSeatGraceWarnings>[0]["sendEmail"] = null,
      db = prisma,
    ) => sendSeatGraceWarnings({ db, now, sendEmail });

    test("renewing before the grace job runs still uses up the grace period", async () => {
      const owner = await createUser({ seats: 2 });
      const self = caller(owner, { allowSelfSetSeats: true });
      await self.account.setPaidPeriodEnded({ ended: true });
      const graceStartedAt = (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }))
        .paidPeriodEndsAt;
      expect((await self.account.seats()).grace).not.toBeNull();

      await self.account.setPaidPeriodEnded({ ended: false });
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).lastGracePeriodStartedAt,
      ).toEqual(graceStartedAt);

      await self.account.setPaidPeriodEnded({ ended: true });
      expect(await self.account.seats()).toEqual({ grace: null });
      expect((await self.account.usage()).seats?.seats).toBe(0);
    });

    test("a grace period that ran out without a warning still tells the owner their seats have ended", async () => {
      const owner = await createUser({ seats: 2 });
      const member = await createUser();
      const groupId = await createGroup(owner);
      await joinWithCode(member, await invite(owner, groupId));
      const endedAt = new Date(Date.now() - 8 * 86_400_000);
      const holdsFrom = new Date(endedAt.getTime() + 7 * 86_400_000);
      await prisma.user.update({ where: { id: owner.id }, data: { paidPeriodEndsAt: endedAt } });
      const emails: Array<{ kind: string; holdsFrom: Date }> = [];
      const sendEmail = async (email: { kind: string; holdsFrom: Date; userId: string }) => {
        if (email.userId === owner.id) emails.push(email);
      };

      await graceWarnings(new Date(), sendEmail);
      await graceWarnings(new Date(), sendEmail);

      expect(
        await prisma.accountNotice.findMany({
          where: { userId: { in: [owner.id, member.id] } },
          select: { userId: true, type: true, holdsFrom: true },
        }),
      ).toEqual([{ userId: owner.id, type: "SEATS_ENDED", holdsFrom }]);
      expect(emails).toEqual([expect.objectContaining({ kind: "ended", holdsFrom })]);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).toMatchObject({
        lastGracePeriodStartedAt: endedAt,
        seatsEndedNoticeFor: endedAt,
      });
    });

    test("one account failing doesn't stop the others being warned or emailed", async () => {
      const [failing, working] = [await createUser(), await createUser()];
      const endedAt = new Date(Date.now() - 3_600_000);
      for (const owner of [failing, working]) {
        await createGroup(owner);
        await prisma.user.update({ where: { id: owner.id }, data: { paidPeriodEndsAt: endedAt } });
      }
      const db = new Proxy(prisma, {
        get: (target, property) =>
          property === "user"
            ? new Proxy(target.user, {
                get: (users, method) =>
                  method === "findUnique"
                    ? (args: { where: { id?: string } }) =>
                        args.where.id === failing.id
                          ? Promise.reject(new Error("Database unavailable"))
                          : users.findUnique(args as Parameters<typeof users.findUnique>[0])
                    : Reflect.get(users, method),
              })
            : Reflect.get(target, property),
      });
      const emailed: string[] = [];
      const consoleError = spyOn(console, "error").mockImplementation(() => {});
      await graceWarnings(
        new Date(),
        async (email) => {
          emailed.push(email.userId);
        },
        db,
      );
      expect(consoleError).toHaveBeenCalledWith("Seat grace check failed for an account");
      consoleError.mockRestore();
      expect(
        (
          await prisma.accountNotice.findMany({
            where: { userId: { in: [failing.id, working.id] } },
            select: { userId: true },
          })
        ).map(({ userId }) => userId),
      ).toEqual([working.id]);
      expect(emailed).toContain(working.id);
      expect(emailed).not.toContain(failing.id);
    });

    test("renewing clears the seat warnings that no longer apply, for the owner and their members", async () => {
      const owner = await createUser({ seats: 2 });
      const member = await createUser();
      const groupId = await createGroup(owner);
      await joinWithCode(member, await invite(owner, groupId));
      await prisma.user.update({
        where: { id: owner.id },
        data: { paidPeriodEndsAt: new Date(Date.now() - 3_600_000) },
      });
      await graceWarnings(new Date());
      const notices = () =>
        prisma.accountNotice.findMany({
          where: { userId: { in: [owner.id, member.id] } },
          select: { type: true },
          orderBy: { type: "asc" },
        });
      expect(await notices()).toEqual([{ type: "SEATS_ENDING" }, { type: "SEAT_HOLD_COMING" }]);

      await caller(owner, { allowSelfSetSeats: true }).account.setPaidPeriodEnded({
        ended: false,
      });
      expect(await notices()).toEqual([]);
    });

    test("members whose phones join during a grace period are told their phones will go on hold", async () => {
      const owner = await createUser({ seats: 4 });
      const [first, later] = [await createUser(), await createUser()];
      const groupId = await createGroup(owner);
      await joinWithCode(first, await invite(owner, groupId));
      const endedAt = new Date(Date.now() - 3_600_000);
      await prisma.user.update({ where: { id: owner.id }, data: { paidPeriodEndsAt: endedAt } });
      await graceWarnings(new Date());
      await joinWithCode(later, await invite(owner, groupId));

      await graceWarnings(new Date(Date.now() + 3_600_000));
      await graceWarnings(new Date(Date.now() + 2 * 3_600_000));

      expect(
        (
          await prisma.accountNotice.findMany({
            where: { userId: { in: [owner.id, first.id, later.id] } },
            select: { userId: true, type: true, groupId: true },
          })
        ).toSorted((a, b) => a.userId.localeCompare(b.userId) || a.type.localeCompare(b.type)),
      ).toEqual(
        [
          { userId: owner.id, type: "SEATS_ENDING", groupId: null },
          { userId: first.id, type: "SEAT_HOLD_COMING", groupId },
          { userId: later.id, type: "SEAT_HOLD_COMING", groupId },
        ].toSorted((a, b) => a.userId.localeCompare(b.userId) || a.type.localeCompare(b.type)),
      );
    });

    test("a phone beyond 64 in a group is held there without taking one of the owner's seats", async () => {
      const owner = await createUser({ seats: 100 });
      const member = await createUser();
      const groupId = await createGroup(owner);
      await joinWithCode(member, await invite(owner, groupId));
      await addMembers(groupId, 62);
      const newDeviceId = `${member.id}-device-65th`;
      await prisma.userDevice.create({
        data: {
          id: newDeviceId,
          userId: member.id,
          publicKey: createDeviceKeyPair().publicKey,
          publicKeyAlgorithm: "X25519",
          name: "Tablet",
          icon: "tablet",
        },
      });
      await prisma.$transaction((tx) =>
        activateDevice({ activatedBy: "phrase", db: tx, deviceId: newDeviceId, userId: member.id }),
      );

      for (const selfHosted of [false, true]) {
        expect(await heldDeviceIds({ groupId, selfHosted })).toEqual(new Set([newDeviceId]));
      }
      expect(await seatsUsed(prisma, owner.id)).toBe(64);
      expect(await freeSeats(prisma, owner.id)).toEqual({ seats: 100, used: 64, free: 36 });
      const usage = await caller(owner).account.usage();
      expect(usage.gauges[0]).toMatchObject({ id: "seats", used: 64, onHold: 0 });
      expect(usage.seats).toMatchObject({ used: 64, onHold: 0 });
      expect(usage.groups[0]?.seats).toMatchObject({ used: 64, onHold: 1 });
      expect(usage.groups[0]?.seats?.phones).toHaveLength(65);
      expect(
        (await caller(member, { deviceId: newDeviceId }).groupMembership.list())[0]?.onHold,
      ).toBe(true);
      expect(
        (
          await caller(member, { deviceId: newDeviceId, selfHosted: true }).groupMembership.list()
        )[0]?.onHold,
      ).toBe(true);
    });
  },
);
