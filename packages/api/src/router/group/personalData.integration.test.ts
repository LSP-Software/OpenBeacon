import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { prisma } from "@openbeacon/database";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const router = createTRPCRouter({ groupMembership: groupMembershipRouter });
const cache = new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 });
const prefix = `personal-data-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const users = [0, 1].map((n) => `${prefix}-${n}`);
const [owner = "", other = ""] = users;
const caller = (userId: string) =>
  router.createCaller({
    cache,
    db: prisma,
    clientIp: "127.0.0.1",
    session: { user: { id: userId } },
  } as Parameters<typeof router.createCaller>[0]);
const storedColor = async (userId: string) =>
  (
    await prisma.personalGroupColor.findFirst({
      where: { owner: { userId, groupId } },
      select: { ciphertext: true },
    })
  )?.ciphertext ?? null;

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "personal group colors with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: users.map((id) => ({ id, name: id, email: `${id}@example.test` })),
      });
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Family",
          groupMembers: {
            create: users.map((userId) => ({ userId, role: "OWNER", joinedEpochNumber: 1 })),
          },
        },
      });
    });
    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    test("an expected ciphertext only replaces the caller's matching color", async () => {
      await expect(
        caller(owner).groupMembership.updateColor({
          groupId,
          ciphertext: "resealed",
          expectedCiphertext: "missing",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await storedColor(owner)).toBeNull();

      await caller(owner).groupMembership.updateColor({ groupId, ciphertext: "first" });
      await caller(other).groupMembership.updateColor({ groupId, ciphertext: "first" });
      await caller(owner).groupMembership.updateColor({
        groupId,
        ciphertext: "resealed",
        expectedCiphertext: "first",
      });
      expect(await storedColor(owner)).toBe("resealed");
      expect(await storedColor(other)).toBe("first");

      await caller(owner).groupMembership.updateColor({ groupId, ciphertext: "newer" });
      await expect(
        caller(owner).groupMembership.updateColor({
          groupId,
          ciphertext: "older-resealed",
          expectedCiphertext: "resealed",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await storedColor(owner)).toBe("newer");
    });

    test("concurrent swaps from the same expected color let exactly one win", async () => {
      await caller(owner).groupMembership.updateColor({ groupId, ciphertext: "shared" });
      const results = await Promise.allSettled(
        ["phone-a", "phone-b"].map((ciphertext) =>
          caller(owner).groupMembership.updateColor({
            groupId,
            ciphertext,
            expectedCiphertext: "shared",
          }),
        ),
      );
      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(["phone-a", "phone-b"]).toContain((await storedColor(owner)) ?? "");
    });
  },
);
