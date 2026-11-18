import { afterAll, describe, expect, test } from "bun:test";
import { deleteAccountNow } from "@openbeacon/api/account-deletion.ts";
import { prisma } from "@openbeacon/database";
import { runAccountDeletion } from "./accountDeletion.ts";

const prefix = `operator-deletion-${crypto.randomUUID()}`;
const userId = `${prefix}-user`;
const ownerId = `${prefix}-owner`;
const groupId = `${prefix}-group`;

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "operator account deletion with PostgreSQL",
  () => {
    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: { in: [userId, ownerId] } } });
      await prisma.accountDeletionCleanup.deleteMany({ where: { userId } });
      await prisma.$disconnect();
    });

    test("the scheduled runner leaves an account alone while the operator command is deleting it", async () => {
      await prisma.user.createMany({
        data: [userId, ownerId].map((id) => ({ id, name: id, email: `${id}@example.test` })),
      });
      await prisma.userDevice.create({
        data: {
          id: `${userId}-device`,
          userId,
          publicKey: "public-key",
          publicKeyAlgorithm: "X25519",
          name: "Phone",
          icon: "phone",
        },
      });
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Former group",
          groupMembers: { create: { userId: ownerId, role: "OWNER", joinedEpochNumber: 1 } },
          groupEpochs: {
            create: { id: `${groupId}-epoch`, epochNumber: 1, senderPublicKey: "public-key" },
          },
        },
      });
      await prisma.place.create({
        data: {
          groupId,
          name: "Home",
          emoji: "🏠",
          epochId: `${groupId}-epoch`,
          senderDeviceId: `${userId}-device`,
          algorithm: "XChaCha20-Poly1305",
          nonce: "nonce",
          ciphertext: "ciphertext",
          createdByUserId: userId,
        },
      });

      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let markLocked = () => {};
      const locked = new Promise<void>((resolve) => {
        markLocked = resolve;
      });
      let holderPid = 0;
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Group" WHERE id = ${groupId} FOR UPDATE`;
          const [backend] = await tx.$queryRaw<
            Array<{ pid: number }>
          >`SELECT pg_backend_pid() AS pid`;
          holderPid = backend?.pid ?? 0;
          markLocked();
          await released;
        },
        { timeout: 20_000 },
      );
      await locked;

      const deleting = deleteAccountNow({
        db: prisma,
        userId,
        imageUrlPrefix: "https://cdn.example/bucket",
      });
      try {
        for (let attempt = 0; ; attempt += 1) {
          const [row] = await prisma.$queryRaw<Array<{ waiting: number }>>`
            SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE datname = current_database() AND pg_blocking_pids(pid) @> ARRAY[${holderPid}::int]
          `;
          if ((row?.waiting ?? 0) > 0) break;
          if (attempt > 500) throw new Error("The operator command never reached the group lock.");
          await Bun.sleep(10);
        }
        const runner = await Promise.race([
          runAccountDeletion().then(() => "finished" as const),
          Bun.sleep(3_000).then(() => "waiting" as const),
        ]);
        expect(runner).toBe("finished");
      } finally {
        release();
        await holder;
      }
      expect(await deleting).toEqual({ data: true, error: null });
      expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();
    }, 20_000);
  },
);
