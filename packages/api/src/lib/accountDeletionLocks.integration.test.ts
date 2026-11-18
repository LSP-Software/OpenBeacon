import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Prisma, prisma } from "@openbeacon/database";
import { deleteAccountRecords } from "./account-deletion.ts";
import { holdRowLock } from "./databaseLocks.testUtil.ts";
import { removeUserDevice } from "./removeDevice.ts";

setDefaultTimeout(30_000);

const prefix = `account-deletion-locks-${crypto.randomUUID()}`;
const deletedUser = `${prefix}-a-user`;
const otherUser = `${prefix}-b-user`;
const otherDevice = `${prefix}-b-device`;
const otherSession = `${prefix}-b-session`;
const pictureGroup = `${prefix}-1-group`;
const sharedGroup = `${prefix}-2-group`;
const imageUrlPrefix = "https://cdn.example/bucket";

const countingTransactions = () => {
  const counter = { transactions: 0 };
  const db = new Proxy(prisma, {
    get: (target, key, receiver) =>
      key === "$transaction"
        ? (...args: unknown[]) => {
            counter.transactions += 1;
            return Reflect.apply(target.$transaction, target, args);
          }
        : Reflect.get(target, key, receiver),
  });
  return { counter, db };
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "account deletion lock order with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: [
          {
            id: deletedUser,
            name: "A",
            email: `${deletedUser}@example.test`,
            pendingDeletion: true,
            deletionDate: new Date(Date.now() - 60_000),
          },
          { id: otherUser, name: "B", email: `${otherUser}@example.test` },
        ],
      });
      await prisma.userDevice.create({
        data: {
          id: otherDevice,
          userId: otherUser,
          publicKey: "b",
          publicKeyAlgorithm: "X25519",
          name: "Phone",
          icon: "phone",
          activatedAt: new Date(),
        },
      });
      await prisma.session.create({
        data: {
          id: otherSession,
          token: `${otherSession}-token`,
          userId: otherUser,
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
      await prisma.group.create({
        data: {
          id: pictureGroup,
          name: "A left it after uploading its picture",
          image: `${imageUrlPrefix}/user/${deletedUser}/uploads/group/${pictureGroup}/avatar/file`,
          groupMembers: { create: [{ userId: otherUser, role: "OWNER", joinedEpochNumber: 1 }] },
        },
      });
      await prisma.group.create({
        data: {
          id: sharedGroup,
          name: "A and B are both members",
          groupMembers: {
            create: [
              { userId: deletedUser, role: "MEMBER", joinedEpochNumber: 1 },
              { userId: otherUser, role: "OWNER", joinedEpochNumber: 1 },
            ],
          },
        },
      });
      await prisma.accountDeletionCleanup.create({ data: { userId: deletedUser, imageKeys: [] } });
    });

    afterAll(async () => {
      await prisma.accountDeletionCleanup.deleteMany({ where: { userId: { startsWith: prefix } } });
      await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.$disconnect();
    });

    test("deleting an account and another member removing a phone don't deadlock over a group picture", async () => {
      const gate = await holdRowLock({
        db: prisma,
        column: "userId",
        id: deletedUser,
        table: "AccountDeletionCleanup",
      });
      const deletion = countingTransactions();
      const deleted = deleteAccountRecords({
        db: deletion.db,
        userId: deletedUser,
        imageUrlPrefix,
        mode: "scheduled",
        securityAlerts: null,
      });
      await gate.waitForWaiters(1);
      const removal = countingTransactions();
      const removed = removeUserDevice({
        db: removal.db,
        deviceId: otherDevice,
        userId: otherUser,
        currentSessionId: otherSession,
        current: true,
      });
      await gate.waitForWaiters(2);
      await gate.release();

      expect(await deleted).toBe(true);
      expect(await removed).toMatchObject({ name: "Phone" });
      expect(deletion.counter.transactions).toBe(2);
      expect(removal.counter.transactions).toBe(1);
      expect(
        await prisma.group.findUniqueOrThrow({
          where: { id: pictureGroup },
          select: { image: true },
        }),
      ).toEqual({ image: null });
      expect(
        await prisma.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${deletedUser}`),
      ).toEqual([]);
    });
  },
);
