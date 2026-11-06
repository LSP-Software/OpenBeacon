import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { auth } from "@openbeacon/auth";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { Prisma, prisma } from "@openbeacon/database";
import { WRAPPED_EPOCH_KEY_ALGORITHM } from "@openbeacon/encryption";
import { deleteAccountRecords } from "../lib/account-deletion.ts";
import { appRouter } from "../root.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const email = `deletion-${crypto.randomUUID()}@example.test`;
const password = "testing-password-123";
const cache = new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 });
let userId = "";
const caller = (sessionId: string) =>
  appRouter.createCaller({
    cache,
    db: prisma,
    clientIp: "127.0.0.1",
    session: { user: { id: userId, email }, session: { id: sessionId } },
  } as Parameters<typeof appRouter.createCaller>[0]);

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "account deletion request with PostgreSQL",
  () => {
    beforeAll(async () => {
      const result = await auth.api.signUpEmail({
        body: { email, password, name: "Deletion Test" },
      });
      userId = result.user.id;
    });
    afterAll(async () => {
      await prisma.group.deleteMany({ where: { groupMembers: { some: { userId } } } });
      await prisma.accountDeletionCleanup.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    test("rejects a sole owner, revokes all sessions, and cancels on successful login", async () => {
      const initialSession = await prisma.session.findFirstOrThrow({ where: { userId } });
      const otherUser = `${userId}-member`;
      await prisma.user.create({
        data: { id: otherUser, email: `${otherUser}@example.test`, name: "Member" },
      });
      const group = await prisma.group.create({
        data: {
          name: "Group",
          groupMembers: {
            create: [
              { userId, role: "OWNER" },
              { userId: otherUser, role: "MEMBER" },
            ],
          },
        },
      });
      await expect(
        caller(initialSession.id).account.requestDeletion({ password: "incorrect" }),
      ).rejects.toThrow("Password is incorrect");
      expect(await prisma.session.count({ where: { userId } })).toBe(1);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pendingDeletion).toBe(
        false,
      );
      await expect(caller(initialSession.id).account.requestDeletion({ password })).rejects.toThrow(
        "Transfer ownership",
      );
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pendingDeletion).toBe(
        false,
      );
      await prisma.group.delete({ where: { id: group.id } });
      await prisma.user.delete({ where: { id: otherUser } });
      await expect(
        caller("revoked-session").account.requestDeletion({ password }),
      ).rejects.toThrow();
      const soloGroup = await prisma.group.create({
        data: { name: "Solo", groupMembers: { create: { userId, role: "OWNER" } } },
      });
      const inviteeId = `${userId}-invitee`;
      await prisma.user.create({
        data: { id: inviteeId, name: "Invitee", email: `${inviteeId}@example.test` },
      });
      const invite = await prisma.groupMemberInvite.create({
        data: { inviterId: userId, recipientId: inviteeId, groupId: soloGroup.id, role: "MEMBER" },
      });
      const sharedCode = "A".repeat(32);
      await prisma.groupSharedInvite.create({
        data: {
          creatorId: userId,
          groupId: soloGroup.id,
          codeHash: createHash("sha256").update(sharedCode).digest("hex"),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await auth.api.signInEmail({ body: { email, password } });
      expect(await prisma.session.count({ where: { userId } })).toBe(2);
      const before = Date.now();
      const scheduled = await caller(initialSession.id).account.requestDeletion({ password });
      expect(await prisma.groupMemberInvite.count({ where: { groupId: soloGroup.id } })).toBe(0);
      expect(await prisma.groupSharedInvite.count({ where: { groupId: soloGroup.id } })).toBe(0);
      const invitee = appRouter.createCaller({
        cache,
        db: prisma,
        clientIp: "127.0.0.1",
        session: {
          user: { id: inviteeId, email: `${inviteeId}@example.test` },
          session: { id: "invitee-session" },
        },
      } as Parameters<typeof appRouter.createCaller>[0]);
      const nextEpoch = {
        createdByDeviceId: "device",
        epochId: "epoch",
        epochNumber: 1,
        recipientKeys: [
          {
            algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
            createdAt: new Date(),
            ephemeralPublicKey: Buffer.alloc(32).toString("base64"),
            epochId: "epoch",
            nonce: Buffer.alloc(24).toString("base64"),
            recipientDeviceId: "device",
            wrappedKey: Buffer.alloc(48).toString("base64"),
          },
        ],
      };
      await expect(invitee.groupInvites.accept({ inviteId: invite.id, nextEpoch })).rejects.toThrow(
        "Invite not found",
      );
      await expect(
        invitee.groupInvites.acceptShared({ code: sharedCode, nextEpoch }),
      ).rejects.toThrow("Invite is invalid or expired");
      await expect(
        caller(initialSession.id).groupInvites.createShared({ groupId: soloGroup.id }),
      ).rejects.toThrow();
      expect(await prisma.group.findUnique({ where: { id: soloGroup.id } })).not.toBeNull();
      expect(scheduled.deletionDate.getTime()).toBeGreaterThanOrEqual(
        before + 7 * 24 * 60 * 60 * 1000,
      );
      expect(await prisma.session.count({ where: { userId } })).toBe(0);
      await expect(
        auth.api.signInEmail({ body: { email, password: "wrong-password" } }),
      ).rejects.toThrow();
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pendingDeletion).toBe(
        true,
      );
      await auth.api.signInEmail({ body: { email, password } });
      expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({
        pendingDeletion: false,
        deletionDate: null,
      });
      const newSession = await prisma.session.findFirstOrThrow({ where: { userId } });
      expect(await caller(newSession.id).account.deletionCancellationNotice()).toEqual({
        cancelled: true,
      });
      expect(await caller(newSession.id).account.deletionCancellationNotice()).toEqual({
        cancelled: true,
      });
      await expect(
        caller(newSession.id).account.acknowledgeDeletionCancellation({ userId: "another-user" }),
      ).rejects.toThrow();
      await prisma.session.delete({ where: { id: newSession.id } });
      await auth.api.signInEmail({ body: { email, password } });
      const laterSession = await prisma.session.findFirstOrThrow({ where: { userId } });
      expect(await caller(laterSession.id).account.deletionCancellationNotice()).toEqual({
        cancelled: true,
      });
      await caller(laterSession.id).account.acknowledgeDeletionCancellation({ userId });
      expect(await caller(laterSession.id).account.deletionCancellationNotice()).toEqual({
        cancelled: false,
      });
      await prisma.user.delete({ where: { id: inviteeId } });
    }, 20_000);
    test("rechecks the deadline after waiting for the account lock", async () => {
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.user.update({
        where: { id: userId },
        data: { pendingDeletion: true, deletionDate: new Date(Date.now() + 600) },
      });
      let unlock: () => void = () => {};
      let locked: () => void = () => {};
      const lockedSignal = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const release = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      const transaction = prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`);
        locked();
        await release;
      });
      await lockedSignal;
      const login = auth.api.signInEmail({ body: { email, password } }).then(
        () => true,
        () => false,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 900));
      unlock();
      await transaction;
      expect(await login).toBe(false);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pendingDeletion).toBe(
        true,
      );
      expect(await prisma.session.count({ where: { userId } })).toBe(0);
    });
    test("concurrent owner requests cannot leave a group without an available owner", async () => {
      const firstEmail = `first-${crypto.randomUUID()}@example.test`;
      const secondEmail = `second-${crypto.randomUUID()}@example.test`;
      const first = await auth.api.signUpEmail({
        body: { email: firstEmail, password, name: "First" },
      });
      const second = await auth.api.signUpEmail({
        body: { email: secondEmail, password, name: "Second" },
      });
      const firstSession = await prisma.session.findFirstOrThrow({
        where: { userId: first.user.id },
      });
      const secondSession = await prisma.session.findFirstOrThrow({
        where: { userId: second.user.id },
      });
      const group = await prisma.group.create({
        data: {
          name: "Owners",
          groupMembers: {
            create: [
              { userId: first.user.id, role: "OWNER" },
              { userId: second.user.id, role: "OWNER" },
            ],
          },
        },
      });
      const request = (id: string, accountEmail: string, sessionId: string) =>
        appRouter
          .createCaller({
            cache,
            db: prisma,
            clientIp: "127.0.0.1",
            session: { user: { id, email: accountEmail }, session: { id: sessionId } },
          } as Parameters<typeof appRouter.createCaller>[0])
          .account.requestDeletion({ password });
      try {
        const results = await Promise.allSettled([
          request(first.user.id, firstEmail, firstSession.id),
          request(second.user.id, secondEmail, secondSession.id),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        expect(
          await prisma.user.count({
            where: { id: { in: [first.user.id, second.user.id] }, pendingDeletion: true },
          }),
        ).toBe(1);
      } finally {
        await prisma.group.deleteMany({ where: { id: group.id } });
        await prisma.user.deleteMany({ where: { id: { in: [first.user.id, second.user.id] } } });
      }
    });
    test("group creation waiting for deletion cannot create an orphaned group", async () => {
      const accountEmail = `creation-${crypto.randomUUID()}@example.test`;
      const account = await auth.api.signUpEmail({
        body: { email: accountEmail, password, name: "Creator" },
      });
      const id = account.user.id;
      const session = await prisma.session.findFirstOrThrow({ where: { userId: id } });
      const groupId = `group-${crypto.randomUUID()}`;
      let unlock: () => void = () => {};
      let locked: () => void = () => {};
      const acquired = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const release = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      const deletion = prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`);
        locked();
        await release;
        await tx.user.update({
          where: { id },
          data: { pendingDeletion: true, deletionDate: new Date(Date.now() + 60_000) },
        });
        await tx.session.deleteMany({ where: { userId: id } });
      });
      try {
        await acquired;
        const caller = appRouter.createCaller({
          cache,
          db: prisma,
          clientIp: "127.0.0.1",
          session: { user: { id, email: accountEmail }, session: { id: session.id } },
        } as Parameters<typeof appRouter.createCaller>[0]);
        const creation = caller.groupLifecycle.create({
          groupId,
          name: "Family",
          initialEpoch: {
            createdByDeviceId: "device",
            epochId: "epoch",
            epochNumber: 1,
            recipientKeys: [
              {
                algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
                createdAt: new Date(),
                ephemeralPublicKey: Buffer.alloc(32).toString("base64"),
                epochId: "epoch",
                nonce: Buffer.alloc(24).toString("base64"),
                recipientDeviceId: "device",
                wrappedKey: Buffer.alloc(48).toString("base64"),
              },
            ],
          },
        });
        unlock();
        await deletion;
        await expect(creation).rejects.toThrow();
        expect(await prisma.group.findUnique({ where: { id: groupId } })).toBeNull();
      } finally {
        unlock();
        await deletion;
        await prisma.group.deleteMany({ where: { id: groupId } });
        await prisma.user.deleteMany({ where: { id } });
      }
    });
    test("refuses a login after the deadline without cancelling deletion or retaining a session", async () => {
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.user.update({
        where: { id: userId },
        data: { pendingDeletion: true, deletionDate: new Date(0) },
      });
      await expect(auth.api.signInEmail({ body: { email, password } })).rejects.toThrow(
        "scheduled for deletion",
      );
      expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({
        pendingDeletion: true,
        deletionDate: new Date(0),
      });
      expect(await prisma.session.count({ where: { userId } })).toBe(0);
    });
    test("successful sign-in and due deletion cannot both win", async () => {
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.user.update({
        where: { id: userId },
        data: { pendingDeletion: true, deletionDate: new Date(0) },
      });
      const [login, deletion] = await Promise.allSettled([
        auth.api.signInEmail({ body: { email, password } }),
        deleteAccountRecords({
          db: prisma,
          userId,
          imageUrlPrefix: "https://cdn.example/bucket",
          mode: "scheduled",
        }),
      ]);
      expect(deletion.status).toBe("fulfilled");
      expect(login.status).toBe("rejected");
      if (deletion.status === "fulfilled") expect(deletion.value).toBe(true);
      expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();
    });
  },
);

test.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "immediate deletion verifies credentials and removes the account without a grace period",
  async () => {
    const immediateEmail = `immediate-${crypto.randomUUID()}@example.test`;
    const signup = await auth.api.signUpEmail({
      body: { email: immediateEmail, password, name: "Immediate deletion" },
    });
    const immediateUserId = signup.user.id;
    try {
      const session = await prisma.session.findFirstOrThrow({ where: { userId: immediateUserId } });
      const immediateCaller = appRouter.createCaller({
        cache,
        db: prisma,
        clientIp: "127.0.0.1",
        session: {
          user: { id: immediateUserId, email: immediateEmail },
          session: { id: session.id },
        },
      } as Parameters<typeof appRouter.createCaller>[0]);
      await expect(
        immediateCaller.account.requestDeletion({ password: "wrong", immediate: true }),
      ).rejects.toThrow("Password is incorrect");
      expect(await prisma.user.findUnique({ where: { id: immediateUserId } })).not.toBeNull();
      await immediateCaller.account.requestDeletion({ password, immediate: true });
      expect(await prisma.user.findUnique({ where: { id: immediateUserId } })).toBeNull();
      expect(await prisma.session.count({ where: { userId: immediateUserId } })).toBe(0);
      expect(
        await prisma.accountDeletionCleanup.findUnique({ where: { userId: immediateUserId } }),
      ).not.toBeNull();
    } finally {
      await prisma.accountDeletionCleanup.deleteMany({ where: { userId: immediateUserId } });
      await prisma.user.deleteMany({ where: { id: immediateUserId } });
    }
  },
);
