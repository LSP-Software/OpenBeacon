import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@openbeacon/database";

const userId = `cli-deletion-${crypto.randomUUID()}`;
const memberId = `${userId}-member`;
const email = `${userId}@example.test`;

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
    test("deletes an account and returns a failure for an unknown email", async () => {
      const run = async (target: string) => {
        const process = Bun.spawn(
          ["bun", "run", "apps/scheduled-jobs/src/deleteAccount.ts", target],
          {
            cwd: new URL("../../../../", import.meta.url).pathname,
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        return { code: await process.exited, output: await new Response(process.stdout).text() };
      };
      const group = await prisma.group.create({
        data: {
          name: "Owner group",
          groupMembers: {
            create: [
              { userId, role: "OWNER" },
              { userId: memberId, role: "MEMBER" },
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
