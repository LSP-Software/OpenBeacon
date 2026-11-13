import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
} from "@openbeacon/encryption";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { removeGroupMemberWithOwnerGuard } from "./assertGroupMemberCanBeRemoved.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";

const router = createTRPCRouter({
  groupInvites: groupInvitesRouter,
  groupLifecycle: groupLifecycleRouter,
  groupMembership: groupMembershipRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `shared-authority-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const [owner, admin, joiner] = ["owner", "admin", "joiner"].map((name) => `${prefix}-${name}`) as [
  string,
  string,
  string,
];
const keys = new Map([owner, admin, joiner].map((userId) => [userId, createDeviceKeyPair()]));
const caller = (userId: string) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId: `${userId}-device`,
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
const adminMembership = () =>
  prisma.groupMember.findUniqueOrThrow({
    where: { userId_groupId: { userId: admin, groupId } },
  });
const tryToJoin = async (code: string) => {
  const context = await caller(joiner).groupInvites.sharedAcceptanceContext({ code });
  const next = createNextGroupEpoch({
    creator: { deviceId: `${joiner}-device`, privateKey: keys.get(joiner)!.privateKey },
    previousEpoch: context.latestEpoch!,
    recipients: context.recipients,
  });
  return caller(joiner).groupInvites.acceptShared({ code, nextEpoch: bundle(next) });
};
const unusedCodesFromAdmin = () =>
  prisma.groupSharedInvite.count({ where: { groupId, creatorId: admin, usedAt: null } });

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "shared invitation authority with PostgreSQL",
  () => {
    beforeAll(async () => {
      for (const userId of [owner, admin, joiner]) {
        const key = keys.get(userId)!;
        await prisma.user.create({
          data: { id: userId, name: userId, email: `${userId}@example.test` },
        });
        await prisma.session.create({
          data: {
            id: `${userId}-session`,
            token: `${userId}-token`,
            userId,
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
        await prisma.userDevice.create({
          data: {
            id: `${userId}-device`,
            userId,
            publicKey: key.publicKey,
            publicKeyAlgorithm: key.algorithm,
            name: "Phone",
            icon: "phone",
            activatedAt: new Date(),
          },
        });
      }
      const device = await prisma.userDevice.findUniqueOrThrow({
        where: { id: `${owner}-device` },
      });
      const initial = createInitialGroupEpoch({
        creator: { deviceId: device.id, privateKey: keys.get(owner)!.privateKey },
        groupId,
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
      await caller(owner).groupLifecycle.create({
        groupId,
        name: "Family",
        initialEpoch: bundle(initial),
      });
    });
    beforeEach(async () => {
      await prisma.groupSharedInvite.deleteMany({ where: { groupId } });
      await prisma.groupMember.deleteMany({ where: { groupId, userId: joiner } });
      await prisma.groupMember.upsert({
        where: { userId_groupId: { userId: admin, groupId } },
        create: { userId: admin, groupId, role: "ADMIN", joinedEpochNumber: 1 },
        update: { role: "ADMIN" },
      });
    });
    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: { in: [owner, admin, joiner] } } });
      await prisma.$disconnect();
    });

    test("a code from a current admin still admits a new member", async () => {
      const { code } = await caller(admin).groupInvites.createShared({ groupId });
      await tryToJoin(code);
      expect(await prisma.groupMember.count({ where: { groupId, userId: joiner } })).toBe(1);
    });

    for (const [change, apply] of [
      [
        "removed",
        async () => prisma.groupMember.delete({ where: { id: (await adminMembership()).id } }),
      ],
      [
        "demoted",
        async () =>
          prisma.groupMember.update({
            where: { id: (await adminMembership()).id },
            data: { role: "MEMBER" },
          }),
      ],
      [
        "pending deletion",
        async () => prisma.user.update({ where: { id: admin }, data: { pendingDeletion: true } }),
      ],
    ] as const) {
      test(`a code stops admitting anyone once its creator is ${change}`, async () => {
        const { code } = await caller(admin).groupInvites.createShared({ groupId });
        const context = await caller(joiner).groupInvites.sharedAcceptanceContext({ code });
        await apply();

        await expect(caller(joiner).groupInvites.sharedAcceptanceContext({ code })).rejects.toThrow(
          "Invite is invalid or expired",
        );
        const next = createNextGroupEpoch({
          creator: { deviceId: `${joiner}-device`, privateKey: keys.get(joiner)!.privateKey },
          previousEpoch: context.latestEpoch!,
          recipients: context.recipients,
        });
        await expect(
          caller(joiner).groupInvites.acceptShared({ code, nextEpoch: bundle(next) }),
        ).rejects.toThrow("Invite is invalid or expired");
        expect(await prisma.groupMember.count({ where: { groupId, userId: joiner } })).toBe(0);
        await prisma.user.update({ where: { id: admin }, data: { pendingDeletion: false } });
      });
    }

    test("demoting an admin to member deletes their unused codes", async () => {
      await caller(admin).groupInvites.createShared({ groupId });
      const { id } = await adminMembership();
      await caller(owner).groupMembership.updateRole({ groupId, memberId: id, role: "ADMIN" });
      expect(await unusedCodesFromAdmin()).toBe(1);

      await caller(owner).groupMembership.updateRole({ groupId, memberId: id, role: "MEMBER" });

      expect(await unusedCodesFromAdmin()).toBe(0);
    });

    test("removing or leaving deletes the member's unused codes", async () => {
      await caller(admin).groupInvites.createShared({ groupId });
      await caller(owner).groupInvites.createShared({ groupId });
      const { id } = await adminMembership();

      await prisma.$transaction((tx) =>
        removeGroupMemberWithOwnerGuard({ db: tx, groupId, memberId: id }),
      );

      expect(await unusedCodesFromAdmin()).toBe(0);
      expect(await prisma.groupSharedInvite.count({ where: { groupId, creatorId: owner } })).toBe(
        1,
      );
    });
  },
);
