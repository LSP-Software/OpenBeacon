import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@openbeacon/database";

const userId = `cli-deletion-${crypto.randomUUID()}`;
const memberId = `${userId}-member`;
const email = `${userId}@example.test`;
const run = async (target: string) => {
  const process = Bun.spawn(["bun", "run", "apps/scheduled-jobs/src/deleteAccount.ts", target], {
    cwd: new URL("../../../../", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: await process.exited,
    output: await new Response(process.stdout).text(),
    error: await new Response(process.stderr).text(),
  };
};
const seedHistory = async (groupId: string) => {
  const device = await prisma.userDevice.create({
    data: {
      id: `${userId}-device-${crypto.randomUUID()}`,
      userId,
      publicKey: "device-key",
      publicKeyAlgorithm: "X25519",
      name: "Phone",
      icon: "phone",
      activatedAt: new Date(),
    },
  });
  const epoch = await prisma.groupEpoch.create({
    data: {
      id: `${userId}-epoch-${crypto.randomUUID()}`,
      groupId,
      epochNumber: 1,
      senderPublicKey: "sender-key",
    },
  });
  await prisma.groupEncryptedPayload.createMany({
    data: [1, 2, 3].map(() => ({
      algorithm: "test",
      ciphertext: "ciphertext",
      clientPointId: crypto.randomUUID(),
      epochId: epoch.id,
      groupId,
      kind: "location",
      nonce: "nonce",
      senderDeviceId: device.id,
      senderUserId: userId,
    })),
  });
  await prisma.session.create({
    data: {
      id: `${userId}-session-${crypto.randomUUID()}`,
      token: crypto.randomUUID(),
      userId,
      deviceId: device.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
};
const accountState = async () => ({
  payloads: await prisma.groupEncryptedPayload.count({ where: { senderUserId: userId } }),
  memberships: await prisma.groupMember.count({ where: { userId } }),
  sessions: await prisma.session.count({ where: { userId } }),
  user: await prisma.user.findUnique({
    where: { id: userId },
    select: { pendingDeletion: true, deletionDate: true },
  }),
});
const removeSeededData = async () => {
  await prisma.groupEncryptedPayload.deleteMany({ where: { senderUserId: userId } });
  await prisma.group.deleteMany({ where: { groupMembers: { some: { userId } } } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.userDevice.deleteMany({ where: { userId } });
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "account deletion CLI with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.create({ data: { id: userId, email, name: "CLI Test" } });
      await prisma.user.create({
        data: { id: memberId, email: `${memberId}@example.test`, name: "Member" },
      });
    });
    afterAll(async () => {
      await prisma.accountDeletionCleanup.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: { in: [userId, memberId] } } });
      await prisma.$disconnect();
    });
    afterEach(removeSeededData);
    test("a refused deletion keeps location history, memberships and sessions", async () => {
      const group = await prisma.group.create({
        data: {
          name: "Shared group",
          groupMembers: {
            create: [
              { userId, role: "OWNER", joinedEpochNumber: 1 },
              { userId: memberId, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
        },
      });
      await seedHistory(group.id);
      const before = await accountState();

      const refused = await run(email);

      expect(refused.code).toBe(1);
      expect(refused.error).toContain("Transfer ownership");
      expect(await accountState()).toEqual(before);
      expect(before).toMatchObject({ payloads: 3, memberships: 1, sessions: 1 });
    });
    test("a group image the server can't identify refuses before deleting history", async () => {
      const group = await prisma.group.create({
        data: {
          name: "Solo group",
          image: "https://elsewhere.example/file/old-bucket/group.webp",
          groupMembers: { create: [{ userId, role: "OWNER", joinedEpochNumber: 1 }] },
        },
      });
      await seedHistory(group.id);
      const before = await accountState();

      const refused = await run(email);

      expect(refused.code).toBe(1);
      expect(await accountState()).toEqual(before);
      expect(before.payloads).toBe(3);
    });
    test("deletes an account and returns a failure for an unknown email", async () => {
      const group = await prisma.group.create({
        data: {
          name: "Owner group",
          groupMembers: {
            create: [
              { userId, role: "OWNER", joinedEpochNumber: 1 },
              { userId: memberId, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
        },
      });
      expect((await run(email)).code).toBe(1);
      expect(await prisma.user.findUnique({ where: { id: userId } })).not.toBeNull();
      await prisma.group.delete({ where: { id: group.id } });
      const deleted = await run(email);
      expect(deleted.code).toBe(0);
      expect(deleted.output).toContain("Account deleted");
      expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();
      expect(await prisma.accountDeletionCleanup.findUnique({ where: { userId } })).not.toBeNull();
      expect((await run(email)).code).toBe(1);
    });
  },
);
