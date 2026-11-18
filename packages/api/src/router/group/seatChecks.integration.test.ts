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
import { heldDeviceIds, seatsUsed } from "../../lib/seats.ts";
import { encryptedTrackingPoint, testClientPointId } from "../../lib/trackingPoints.testUtil.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { accountRouter } from "../accountRouter.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";
import { groupOwnershipRouter } from "./groupOwnershipRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";

const router = createTRPCRouter({
  account: accountRouter,
  groupInvites: groupInvitesRouter,
  groupLifecycle: groupLifecycleRouter,
  groupOwnership: groupOwnershipRouter,
  groupTracking: groupTrackingRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `seat-checks-${crypto.randomUUID()}`;
const keys = new Map<string, DeviceKeyPair>();
let userCount = 0;

type TestUser = { id: string; deviceIds: string[] };

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
          "Creating a group needs 2 seats, one for each of your phones, and you have 1 free.",
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
      expect(await caller(owner).groupInvites.seats({ groupId })).toMatchObject({
        blockedBy: null,
        free: 1,
        groupSeats: 1,
        seats: 2,
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
      expect(await caller(owner).groupInvites.seats({ groupId })).toMatchObject({
        blockedBy: "NO_FREE_SEATS",
        free: 0,
        message:
          "You're using all 2 of your seats. Add seats or remove someone to invite more people.",
      });

      await prisma.groupMember.create({
        data: { groupId, userId: editor.id, role: "EDITOR", joinedEpochNumber: 1 },
      });
      await prisma.user.update({ where: { id: owner.id }, data: { seats: 4 } });
      await caller(editor).groupInvites.createShared({ groupId });
      await prisma.user.update({ where: { id: owner.id }, data: { seats: 3 } });
      await expect(caller(editor).groupInvites.createShared({ groupId })).rejects.toMatchObject({
        ...noFreeSeats,
        message: `Name ${owner.id} owns this group and is using all 3 of their seats. Ask Name ${owner.id} to add seats or to remove someone.`,
      });
    });

    test("a joiner with two phones can't join with only one free seat, and is told before trying", async () => {
      const owner = await createUser({ seats: 2 });
      const joiner = await createUser({ phones: 2 });
      const groupId = await createGroup(owner);
      const code = await invite(owner, groupId);

      expect(await caller(joiner).groupInvites.sharedPreview({ code })).toMatchObject({
        owner: { name: `Name ${owner.id}` },
        seats: { needed: 2, free: 1, perGroup: 64 },
        joinBlockedBy: "NO_FREE_SEATS",
      });
      await expect(joinWithCode(joiner, code)).rejects.toMatchObject(noFreeSeats);

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
      expect(await caller(owner).account.seats()).toMatchObject({
        seats: 4,
        used: 4,
        enforced: true,
      });
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
      expect(await caller(owner).groupInvites.seats({ groupId })).toMatchObject({
        blockedBy: "GROUP_FULL",
        groupSeats: 64,
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

      expect(await heldDeviceIds({ db: prisma, groupId, selfHosted: false })).toEqual(
        new Set([newDeviceId]),
      );
      expect(await heldDeviceIds({ db: prisma, groupId, selfHosted: true })).toEqual(new Set());
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
      expect(await heldDeviceIds({ db: prisma, groupId, selfHosted: false })).toEqual(new Set());
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

      await expect(caller(admin).groupOwnership.accept({ groupId })).rejects.toMatchObject({
        ...noFreeSeats,
        message: "Taking over this group needs 2 seats and you have 1 free. Add seats first.",
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
      expect(await caller(user).account.seats()).toMatchObject({ selfSetAllowed: false, seats: 2 });

      const allowed = caller(user, { allowSelfSetSeats: true });
      expect(await allowed.account.seats()).toMatchObject({ selfSetAllowed: true, max: 1_024 });
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
        seats: { needed: 2, free: null },
        joinBlockedBy: null,
      });
      await joinWithCode(joiner, code, selfHosted);
      expect(await caller(owner, selfHosted).groupInvites.seats({ groupId })).toMatchObject({
        blockedBy: null,
        free: null,
        seats: null,
      });
      expect(await caller(owner, selfHosted).account.seats()).toMatchObject({ enforced: false });
      expect(await heldDeviceIds({ db: prisma, groupId, selfHosted: true })).toEqual(new Set());

      const membership = await prisma.groupMember.update({
        where: { userId_groupId: { userId: joiner.id, groupId } },
        data: { role: "ADMIN" },
      });
      await caller(owner, selfHosted).groupOwnership.offer({ groupId, memberId: membership.id });
      await caller(joiner, selfHosted).groupOwnership.accept({ groupId });
    });
  },
);
