import { afterAll, describe, expect, test } from "bun:test";
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

    test("an account with no room can't create its first group, and an owner needs no new seat for another", async () => {
      const noSeats = await createUser({ seats: 0 });
      await expect(
        caller(noSeats).groupLifecycle.create(await createInput(noSeats)),
      ).rejects.toMatchObject({
        ...noFreeSeats,
        message: "Your account has no room for people. Add room to create a group.",
      });
      expect(await prisma.group.count({ where: { ownerId: noSeats.id } })).toBe(0);

      const owner = await createUser({ phones: 3, seats: 1 });
      await createGroup(owner);
      await createGroup(owner);
      expect(await freeSeats(prisma, owner.id)).toEqual({ seats: 1, used: 1, free: 0 });
      await setSeats(owner, 0);
      await createGroup(owner);
      expect(await prisma.group.count({ where: { ownerId: owner.id } })).toBe(3);
    });

    test("an owner with room for 2 can invite one person, then can't create another invite", async () => {
      const owner = await createUser({ seats: 2 });
      const editor = await createUser();
      const joiner = await createUser({ phones: 3 });
      const groupId = await createGroup(owner);
      expect(await caller(owner).groupInvites.seats({ groupId })).toEqual({
        blockedBy: null,
        message: null,
      });

      await joinWithCode(joiner, await invite(owner, groupId));
      expect(await seatsUsed(prisma, owner.id)).toBe(2);

      const full =
        "You have room for 2 people and they're all in your groups. Add room or remove someone to invite more people.";
      await expect(caller(owner).groupInvites.createShared({ groupId })).rejects.toMatchObject({
        ...noFreeSeats,
        message: full,
      });
      await expect(
        caller(owner).groupInvites.send({
          groupId,
          invites: [{ email: `${editor.id}@example.test`, role: "MEMBER" }],
        }),
      ).rejects.toMatchObject(noFreeSeats);
      expect(await caller(owner).groupInvites.seats({ groupId })).toEqual({
        blockedBy: "NO_FREE_SEATS",
        message: full,
      });

      await prisma.groupMember.create({
        data: { groupId, userId: editor.id, role: "EDITOR", joinedEpochNumber: 1 },
      });
      await setSeats(owner, 4);
      await caller(editor).groupInvites.createShared({ groupId });
      await setSeats(owner, 3);
      const noRoom = `Name ${owner.id} owns this group and has no room for more people. Ask Name ${owner.id} to add room or to remove someone.`;
      await expect(caller(editor).groupInvites.createShared({ groupId })).rejects.toMatchObject({
        ...noFreeSeats,
        message: noRoom,
      });
      await setSeats(owner, 2);
      expect(await caller(editor).groupInvites.seats({ groupId })).toEqual({
        blockedBy: "NO_FREE_SEATS",
        message: noRoom,
      });
      expect(await caller(owner).groupInvites.seats({ groupId })).toEqual({
        blockedBy: "NO_FREE_SEATS",
        message:
          "You have room for 2 people but 3 are in your groups. Add room or remove someone to invite more people.",
      });
      await setSeats(owner, 1);
      expect((await caller(owner).groupInvites.seats({ groupId })).message).toBe(
        "You have room for 1 person but 3 are in your groups. Add room or remove someone to invite more people.",
      );
    });

    test("joining needs a free seat unless the joiner is already one of the owner's people, and is told before trying", async () => {
      const owner = await createUser({ seats: 3 });
      const known = await createUser({ phones: 2 });
      const filler = await createUser();
      const stranger = await createUser();
      const family = await createGroup(owner);
      const friends = await createGroup(owner);
      await joinWithCode(known, await invite(owner, family));
      const knownCode = await invite(owner, friends);
      const strangerCode = await invite(owner, friends);
      await joinWithCode(filler, await invite(owner, family));
      expect(await freeSeats(prisma, owner.id)).toEqual({ seats: 3, used: 3, free: 0 });

      expect(
        await caller(stranger).groupInvites.sharedPreview({ code: strangerCode }),
      ).toMatchObject({
        owner: { name: `Name ${owner.id}` },
        seats: { needed: 1, perGroup: 64 },
        joinBlockedBy: "NO_FREE_SEATS",
      });
      expect(
        await caller(stranger).groupInvites.sharedPreview({ code: strangerCode }),
      ).not.toHaveProperty("seats.free");
      await expect(joinWithCode(stranger, strangerCode)).rejects.toMatchObject({
        ...noFreeSeats,
        message: `This group has no room for you. Ask Name ${owner.id} to make room.`,
      });

      expect(await caller(known).groupInvites.sharedPreview({ code: knownCode })).toMatchObject({
        seats: { needed: 0, perGroup: 64 },
        joinBlockedBy: null,
      });
      await joinWithCode(known, knownCode);
      expect(await seatsUsed(prisma, owner.id)).toBe(3);

      const emailInvite = await prisma.groupMemberInvite.create({
        data: { groupId: friends, inviterId: owner.id, recipientId: stranger.id, role: "MEMBER" },
      });
      expect(
        await caller(stranger).groupInvites.preview({ inviteId: emailInvite.id }),
      ).toMatchObject({ joinBlockedBy: "NO_FREE_SEATS" });
      const context = await caller(stranger).groupInvites.acceptanceContext({
        inviteId: emailInvite.id,
      });
      await expect(
        caller(stranger).groupInvites.accept({
          inviteId: emailInvite.id,
          nextEpoch: bundle(
            createNextGroupEpoch({
              creator: {
                deviceId: stranger.deviceIds[0]!,
                privateKey: keys.get(stranger.deviceIds[0]!)!.privateKey,
              },
              previousEpoch: context.latestEpoch!,
              recipients: context.recipients,
            }),
          ),
        }),
      ).rejects.toMatchObject(noFreeSeats);
      expect(await prisma.groupMember.count({ where: { groupId: friends } })).toBe(2);
    });

    test("two joins into different groups racing for the owner's last seat let exactly one in", async () => {
      const owner = await createUser({ seats: 2 });
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
      expect(await seatsUsed(prisma, owner.id)).toBe(2);
    });

    test("the owner and a person in two of the owner's groups each count once, whatever their phones", async () => {
      const owner = await createUser({ phones: 2, seats: 4 });
      const member = await createUser({ phones: 3 });
      for (const groupId of [await createGroup(owner), await createGroup(owner)]) {
        await joinWithCode(member, await invite(owner, groupId));
      }
      expect((await caller(owner).account.usage()).seats).toMatchObject({ seats: 4, used: 2 });
    });

    test("a 65th person in a group is refused, on hosted and self-hosted servers", async () => {
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
        await expect(joinWithCode(joiner, code, { selfHosted })).rejects.toMatchObject({
          ...groupFull,
          message: "This group is full. A group can have up to 64 people.",
        });
        await expect(
          caller(owner, { selfHosted }).groupInvites.createShared({ groupId }),
        ).rejects.toMatchObject(groupFull);
      }
      expect(await caller(owner).groupInvites.seats({ groupId })).toEqual({
        blockedBy: "GROUP_FULL",
        message: "This group is full. A group can have up to 64 people.",
      });
    });

    test("activating another phone never holds it or uses a seat", async () => {
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

      expect(await heldDeviceIds({ groupId, selfHosted: false })).toEqual(new Set());
      expect(await freeSeats(prisma, owner.id)).toEqual({ seats: 2, used: 2, free: 0 });
      await caller(member, { deviceId: newDeviceId }).groupTracking.getLatest({ groupId });
    });

    test("taking over a group needs room for each of its people who isn't already yours", async () => {
      const owner = await createUser({ seats: 3 });
      const admin = await createUser({ seats: 2 });
      const member = await createUser();
      const groupId = await createGroup(owner);
      await joinWithCode(admin, await invite(owner, groupId));
      await joinWithCode(member, await invite(owner, groupId));
      const membership = await prisma.groupMember.update({
        where: { userId_groupId: { userId: admin.id, groupId } },
        data: { role: "ADMIN" },
      });
      await caller(owner).groupOwnership.offer({ groupId, memberId: membership.id });
      expect((await caller(admin).groupOwnership.offers())[0]?.seats).toBe(3);
      await expect(caller(admin).groupOwnership.accept({ groupId })).rejects.toMatchObject({
        ...noFreeSeats,
        message:
          "Taking over this group needs room for 3 more people, and you have room for 2 more. Add room first.",
      });

      const theirs = await createGroup(admin);
      await joinWithCode(member, await invite(admin, theirs));
      expect((await caller(admin).groupOwnership.offers())[0]?.seats).toBe(1);
      await expect(caller(admin).groupOwnership.accept({ groupId })).rejects.toMatchObject({
        ...noFreeSeats,
        message:
          "Taking over this group needs room for 1 more person, and you have no room left. Add room first.",
      });
      await setSeats(admin, 3);
      await caller(admin).groupOwnership.accept({ groupId });
      expect((await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).ownerId).toBe(
        admin.id,
      );
      expect(await seatsUsed(prisma, admin.id)).toBe(3);
      expect(await seatsUsed(prisma, owner.id)).toBe(0);
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

    test("self-hosted servers skip every seat check and hold no one", async () => {
      const selfHosted = { selfHosted: true };
      const owner = await createUser({ seats: 0 });
      const joiner = await createUser({ phones: 2, seats: 0 });
      const groupId = await createGroup(owner, selfHosted);
      const code = await invite(owner, groupId, selfHosted);
      expect(await caller(joiner, selfHosted).groupInvites.sharedPreview({ code })).toMatchObject({
        seats: { needed: 0, perGroup: 64 },
        joinBlockedBy: null,
      });
      await joinWithCode(joiner, code, selfHosted);
      expect(await caller(owner, selfHosted).groupInvites.seats({ groupId })).toEqual({
        blockedBy: null,
        message: null,
      });
      expect(await heldDeviceIds({ groupId, selfHosted: true })).toEqual(new Set());
      expect(
        (await caller(joiner, selfHosted).groupMembership.list()).find(({ id }) => id === groupId)
          ?.onHold,
      ).toBe(false);
      await caller(joiner, selfHosted).groupTracking.getLatest({ groupId });

      const membership = await prisma.groupMember.update({
        where: { userId_groupId: { userId: joiner.id, groupId } },
        data: { role: "ADMIN" },
      });
      await caller(owner, selfHosted).groupOwnership.offer({ groupId, memberId: membership.id });
      expect((await caller(joiner, selfHosted).groupOwnership.offers())[0]?.seats).toBeNull();
      await caller(joiner, selfHosted).groupOwnership.accept({ groupId });
    });

    test("fewer seats hold the people who joined last, in all the owner's groups and on all their phones, and the owner last", async () => {
      const owner = await createUser({ seats: 5 });
      const first = await createUser({ phones: 2 });
      const second = await createUser();
      const third = await createUser({ phones: 2 });
      const family = await createGroup(owner);
      const friends = await createGroup(owner);
      await joinWithCode(first, await invite(owner, family));
      await joinWithCode(second, await invite(owner, friends));
      await joinWithCode(third, await invite(owner, family));
      await joinWithCode(third, await invite(owner, friends));
      await joinWithCode(first, await invite(owner, friends));
      const held = async () =>
        (await heldSeatDevices({ db: prisma, groupIds: [family, friends], selfHosted: false }))
          .map(
            ({ groupId, deviceId }) => `${groupId === family ? "family" : "friends"} ${deviceId}`,
          )
          .toSorted();
      const heldIn = (groups: string[], users: TestUser[]) =>
        groups
          .flatMap((group) =>
            users.flatMap(({ deviceIds }) => deviceIds.map((id) => `${group} ${id}`)),
          )
          .toSorted();
      expect(await held()).toEqual([]);

      await setSeats(owner, 3);
      expect(await held()).toEqual(heldIn(["family", "friends"], [third]));
      expect(
        (await caller(third, { deviceId: third.deviceIds[1]! }).groupMembership.list()).map(
          ({ onHold }) => onHold,
        ),
      ).toEqual([true, true]);
      expect((await caller(first).groupMembership.list()).map(({ onHold }) => onHold)).toEqual([
        false,
        false,
      ]);

      await setSeats(owner, 2);
      expect(await held()).toEqual(
        [...heldIn(["family", "friends"], [third]), ...heldIn(["friends"], [second])].toSorted(),
      );
      expect(await caller(second).accountNotices.sync({ cursor: null })).toMatchObject({
        heldGroupIds: [friends],
      });

      await setSeats(owner, 1);
      expect(await held()).toEqual(
        [
          ...heldIn(["family", "friends"], [first, third]),
          ...heldIn(["friends"], [second]),
        ].toSorted(),
      );
      await caller(owner).groupTracking.getLatest({ groupId: family });

      await setSeats(owner, 0);
      expect(await held()).toEqual(
        [
          ...heldIn(["family", "friends"], [owner, first, third]),
          ...heldIn(["friends"], [second]),
        ].toSorted(),
      );

      await setSeats(owner, 3);
      expect(await held()).toEqual(heldIn(["family", "friends"], [third]));
      await leave(first, family);
      expect(await held()).toEqual(heldIn(["friends"], [first]));
      await leave(first, friends);
      expect(await held()).toEqual([]);

      await setSeats(owner, 2);
      expect(await held()).toEqual(heldIn(["family", "friends"], [third]));
      await prisma.userDevice.update({
        where: { id: third.deviceIds[1]! },
        data: { revokedAt: new Date() },
      });
      expect(await held()).toEqual(
        heldIn(["family", "friends"], [{ ...third, deviceIds: [third.deviceIds[0]!] }]),
      );
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

    test("usage lists the people in each owned group in seat order with holds, and only your own hold elsewhere", async () => {
      const owner = await createUser({ phones: 2, seats: 3 });
      const member = await createUser({ phones: 2 });
      const late = await createUser();
      const other = await createUser({ seats: 4 });
      const family = await createGroup(owner);
      await joinWithCode(member, await invite(owner, family));
      await joinWithCode(late, await invite(owner, family));
      const theirs = await createGroup(other);
      await joinWithCode(owner, await invite(other, theirs));
      await setSeats(owner, 2);
      const usage = await caller(owner, { allowSelfSetSeats: true }).account.usage();
      expect(usage).toEqual({
        gauges: [
          {
            id: "seats",
            label: "People",
            used: 3,
            max: 2,
            onHold: 1,
            unit: { one: "person", other: "people" },
          },
          {
            id: "groups",
            label: "Groups",
            used: 2,
            max: 16,
            onHold: 0,
            unit: { one: "group", other: "groups" },
          },
          {
            id: "phones",
            label: "Phones",
            used: 2,
            max: 10,
            onHold: 0,
            unit: { one: "phone", other: "phones" },
          },
        ],
        limits: [
          {
            id: "history",
            label: "Location history kept",
            value: 30,
            unit: { one: "day", other: "days" },
          },
        ],
        seats: { seats: 2, used: 3, onHold: 1, max: 1_024, selfSetAllowed: true },
        groups: [
          {
            id: family,
            name: "Family",
            owner: { userId: owner.id, name: `Name ${owner.id}` },
            isOwner: true,
            people: [
              { userId: owner.id, name: `Name ${owner.id}`, isYou: true, onHold: false },
              { userId: member.id, name: `Name ${member.id}`, isYou: false, onHold: false },
              { userId: late.id, name: `Name ${late.id}`, isYou: false, onHold: true },
            ],
            youAreOnHold: false,
          },
          {
            id: theirs,
            name: "Family",
            owner: { userId: other.id, name: `Name ${other.id}` },
            isOwner: false,
            people: null,
            youAreOnHold: false,
          },
        ],
      });
      expect((await caller(owner).account.usage()).seats?.selfSetAllowed).toBe(false);
      expect((await caller(late).account.usage()).groups).toMatchObject([
        { id: family, isOwner: false, people: null, youAreOnHold: true },
      ]);

      await setSeats(other, 1);
      expect((await caller(owner).account.usage()).groups[1]).toMatchObject({
        id: theirs,
        youAreOnHold: true,
      });
    });

    test("usage on a self-hosted server shows groups and phones only", async () => {
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
      expect(usage.gauges.map(({ id }) => id)).toEqual(["groups", "phones"]);
      expect(usage.gauges[0]).toMatchObject({ used: 1, max: 16 });
      expect(usage.seats).toBeNull();
      expect(usage.groups).toEqual([
        {
          id: groupId,
          name: "Family",
          owner: { userId: owner.id, name: `Name ${owner.id}` },
          isOwner: true,
          people: null,
          youAreOnHold: false,
        },
      ]);
      expect((await caller(member, { selfHosted: true }).account.usage()).groups[0]).toMatchObject({
        isOwner: false,
        people: null,
        youAreOnHold: false,
      });
    });
  },
);
