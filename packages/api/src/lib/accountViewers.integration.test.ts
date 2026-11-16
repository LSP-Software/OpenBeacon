import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@openbeacon/database";
import { readAccountViewers } from "./accountViewers.ts";

const prefix = `account-viewers-${crypto.randomUUID()}`;
const [me, alex, sam, jo, kim, old] = ["me", "alex", "sam", "jo", "kim", "old"].map(
  (name) => `${prefix}-${name}`,
) as [string, string, string, string, string, string];
const users = [me, alex, sam, jo, kim, old];
const [family, former, stranger] = ["family", "former", "stranger"].map(
  (name) => `${prefix}-${name}`,
) as [string, string, string];
const day = 24 * 60 * 60_000;
const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * day);

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "account viewers with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: users.map((id) => ({
          id,
          name: id.slice(prefix.length + 1),
          email: `${id}@example.test`,
        })),
      });
      await prisma.group.createMany({
        data: [family, former, stranger].map((id) => ({ id, name: id.slice(prefix.length + 1) })),
      });
      await prisma.groupMember.createMany({
        data: [
          { groupId: family, userId: me, createdAt: ago(30) },
          { groupId: family, userId: alex, createdAt: ago(3) },
          { groupId: former, userId: jo, createdAt: ago(30) },
          { groupId: stranger, userId: kim, createdAt: ago(30) },
        ].map((row) => ({ ...row, role: "MEMBER" as const, joinedEpochNumber: 1 })),
      });
      await prisma.groupEvent.createMany({
        data: [
          {
            groupId: family,
            type: "MEMBER_JOINED" as const,
            subjectUserId: alex,
            createdAt: ago(3),
          },
          {
            groupId: family,
            type: "MEMBER_JOINED" as const,
            subjectUserId: sam,
            createdAt: ago(5),
          },
          { groupId: family, type: "MEMBER_LEFT" as const, subjectUserId: sam, createdAt: ago(2) },
          { groupId: family, type: "MEMBER_LEFT" as const, subjectUserId: old, createdAt: ago(20) },
          { groupId: former, type: "MEMBER_LEFT" as const, subjectUserId: me, createdAt: ago(1) },
          {
            groupId: stranger,
            type: "MEMBER_LEFT" as const,
            subjectUserId: sam,
            createdAt: ago(1),
          },
        ],
      });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { in: [family, former, stranger] } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    test("lists current viewers once, and past viewers only from your own groups and window", async () => {
      const viewers = await readAccountViewers({ db: prisma, now, userId: me });

      expect(viewers.current).toEqual([
        {
          userId: alex,
          name: "alex",
          image: null,
          groups: [{ id: family, name: "family", since: ago(3) }],
        },
      ]);
      expect(viewers.past).toEqual([
        {
          groupId: former,
          groupName: "former",
          userId: jo,
          name: "jo",
          image: null,
          from: null,
          to: ago(1),
          reason: "youLeft",
        },
        {
          groupId: family,
          groupName: "family",
          userId: sam,
          name: "sam",
          image: null,
          from: ago(5),
          to: ago(2),
          reason: "theyLeft",
        },
      ]);
    });
  },
);
