import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { readGroupHistory } from "../../lib/groupHistory.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupHistoryRouter } from "./groupHistoryRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";
import { groupSettingsRouter } from "./groupSettingsRouter.ts";

const router = createTRPCRouter({
  groupHistory: groupHistoryRouter,
  groupMembership: groupMembershipRouter,
  groupSettings: groupSettingsRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `group-history-${crypto.randomUUID()}`;
const owner = `${prefix}-owner`;
const member = `${prefix}-member`;
const late = `${prefix}-late`;
const outsider = `${prefix}-outsider`;
const users = [owner, member, late, outsider];
const groupId = `${prefix}-group`;
const placeId = `${prefix}-home`;
const minute = 60_000;
const day = 24 * 60 * minute;
const ago = (ms: number) => new Date(Date.now() - ms);

const caller = (userId: string) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      deviceId: `${userId}-phone`,
      unverifiedDeviceId: null,
      session: { user: { id: userId }, session: { id: `${userId}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );

const seedEvent = (id: string, createdAt: Date, actorUserId = owner) =>
  prisma.groupEvent.create({
    data: {
      id: `${prefix}-${id}`,
      groupId,
      type: "GROUP_RENAMED",
      actorUserId,
      name: id,
      createdAt,
    },
  });

const seedTransition = (id: string, occurredAt: Date, userId = member) =>
  prisma.placeTransition.create({
    data: {
      id: `${prefix}-${id}`,
      placeId,
      groupId,
      deviceId: `${userId}-phone`,
      userId,
      direction: "ARRIVE",
      occurredAt,
      clientId: crypto.randomUUID(),
      createdAt: occurredAt,
    },
  });

const setJoinedAt = (userId: string, createdAt: Date) =>
  prisma.groupMember.update({
    where: { userId_groupId: { userId, groupId } },
    data: { createdAt },
  });

const listedIds = async (userId: string) =>
  (await caller(userId).groupHistory.list({ groupId })).items.map(({ id }) =>
    id.slice(prefix.length + 1),
  );

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "group history with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: users.map((id) => ({
          id,
          name: id.slice(prefix.length + 1),
          email: `${id}@example.test`,
        })),
      });
      await prisma.userDevice.createMany({
        data: users.map((userId) => ({
          id: `${userId}-phone`,
          userId,
          name: "Phone",
          activatedAt: new Date(),
          icon: "phone" as const,
          publicKey: "public-key",
          publicKeyAlgorithm: "X25519",
        })),
      });
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Family",
          groupEpochs: {
            create: { id: `${groupId}-epoch`, epochNumber: 1, senderPublicKey: "public-key" },
          },
        },
      });
      await prisma.place.create({
        data: {
          id: placeId,
          groupId,
          name: "Home",
          emoji: "🏠",
          epochId: `${groupId}-epoch`,
          senderDeviceId: `${owner}-phone`,
          algorithm: "XChaCha20-Poly1305",
          nonce: "nonce",
          ciphertext: "ciphertext",
          createdByUserId: owner,
        },
      });
    });

    beforeEach(async () => {
      await prisma.groupEvent.deleteMany({ where: { groupId } });
      await prisma.placeTransition.deleteMany({ where: { groupId } });
      await prisma.groupMember.deleteMany({ where: { groupId } });
      await prisma.groupMember.createMany({
        data: [
          { userId: owner, role: "OWNER" as const },
          { userId: member, role: "MEMBER" as const },
        ].map((row) => ({ ...row, groupId, joinedEpochNumber: 1, createdAt: ago(10 * day) })),
      });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    test("merges group events and place arrivals newest first, within the last 14 days", async () => {
      await seedEvent("expired", ago(15 * day));
      await seedTransition("expiredArrival", ago(14 * day + minute));
      await seedEvent("renamed", ago(3 * minute));
      await seedTransition("arrived", ago(2 * minute));
      await seedEvent("renamedAgain", ago(minute));

      const { items, nextBefore } = await caller(member).groupHistory.list({ groupId });
      expect(items.map(({ id }) => id.slice(prefix.length + 1))).toEqual([
        "renamedAgain",
        "arrived",
        "renamed",
      ]);
      expect(items[0]).toMatchObject({
        kind: "group",
        type: "GROUP_RENAMED",
        actor: { userId: owner, name: "owner" },
        subject: null,
      });
      expect(items[1]).toMatchObject({
        kind: "place",
        placeName: "Home",
        userId: member,
        deviceName: "Phone",
      });
      expect(nextBefore).toBeNull();
    });

    test("pages through both kinds without gaps or repeats, including equal times", async () => {
      const sameTime = ago(5 * minute);
      await seedEvent("a", ago(7 * minute));
      await seedTransition("b", ago(6 * minute));
      await seedEvent("c", sameTime);
      await seedTransition("d", sameTime);
      await seedEvent("e", ago(4 * minute));
      await seedTransition("f", ago(3 * minute));
      const all = await readGroupHistory({
        before: undefined,
        categories: undefined,
        db: prisma,
        groupId,
        limit: 100,
        memberSince: ago(day),
        now: new Date(),
      });
      expect(all.items.map(({ id }) => id.slice(prefix.length + 1))).toEqual([
        "f",
        "e",
        "d",
        "c",
        "b",
        "a",
      ]);
      for (const limit of [1, 2, 3]) {
        const seen: string[] = [];
        let before: { at: Date; id: string } | undefined;
        for (let page = 0; page < 10; page++) {
          const result = await readGroupHistory({
            before,
            categories: undefined,
            db: prisma,
            groupId,
            limit,
            memberSince: ago(day),
            now: new Date(),
          });
          seen.push(...result.items.map(({ id }) => id));
          if (!result.nextBefore) break;
          before = result.nextBefore;
        }
        expect(seen).toEqual(all.items.map(({ id }) => id));
      }
    });

    test("a member sees only what happened since their latest join, even after rejoining", async () => {
      await prisma.groupMember.create({
        data: {
          groupId,
          userId: late,
          role: "MEMBER",
          joinedEpochNumber: 1,
          createdAt: ago(5 * minute),
        },
      });
      await seedEvent("beforeJoin", ago(6 * minute));
      await seedTransition("arrivedBeforeJoin", ago(7 * minute));
      await seedEvent("afterJoin", ago(4 * minute));
      expect(await listedIds(late)).toEqual(["afterJoin"]);
      expect(await listedIds(member)).toEqual(["afterJoin", "beforeJoin", "arrivedBeforeJoin"]);

      await prisma.groupMember.delete({ where: { userId_groupId: { userId: late, groupId } } });
      await expect(caller(late).groupHistory.list({ groupId })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await prisma.groupMember.create({
        data: {
          groupId,
          userId: late,
          role: "MEMBER",
          joinedEpochNumber: 1,
          createdAt: new Date(),
        },
      });
      await seedEvent("afterRejoin", new Date(Date.now() + 1_000));
      expect(await listedIds(late)).toEqual(["afterRejoin"]);
    });

    test("filters by category, and paging keeps the filter", async () => {
      await seedEvent("renamed", ago(5 * minute));
      await seedTransition("arrived", ago(4 * minute));
      await prisma.groupEvent.createMany({
        data: [
          {
            id: `${prefix}-joined`,
            type: "MEMBER_JOINED" as const,
            subjectUserId: member,
            createdAt: ago(3 * minute),
          },
          {
            id: `${prefix}-promoted`,
            type: "ROLE_CHANGED" as const,
            actorUserId: owner,
            subjectUserId: member,
            role: "ADMIN" as const,
            createdAt: ago(2 * minute),
          },
          {
            id: `${prefix}-placeAdded`,
            type: "PLACE_ADDED" as const,
            actorUserId: owner,
            name: "Home",
            emoji: "🏠",
            createdAt: ago(minute),
          },
        ].map((event) => ({ ...event, groupId })),
      });
      const filtered = async (
        categories: Array<"arrivals" | "members" | "roles" | "group" | "places">,
      ) =>
        (await caller(member).groupHistory.list({ groupId, categories })).items.map(({ id }) =>
          id.slice(prefix.length + 1),
        );
      expect(await filtered(["arrivals"])).toEqual(["arrived"]);
      expect(await filtered(["roles"])).toEqual(["promoted"]);
      expect(await filtered(["group"])).toEqual(["renamed"]);
      expect(await filtered(["places"])).toEqual(["placeAdded"]);
      expect(await filtered(["members", "arrivals"])).toEqual(["joined", "arrived"]);
      expect(await listedIds(member)).toHaveLength(5);

      const firstPage = await readGroupHistory({
        before: undefined,
        categories: ["members", "arrivals"],
        db: prisma,
        groupId,
        limit: 1,
        memberSince: ago(day),
        now: new Date(),
      });
      const secondPage = await readGroupHistory({
        before: firstPage.nextBefore ?? undefined,
        categories: ["members", "arrivals"],
        db: prisma,
        groupId,
        limit: 1,
        memberSince: ago(day),
        now: new Date(),
      });
      expect(
        [...firstPage.items, ...secondPage.items].map(({ id }) => id.slice(prefix.length + 1)),
      ).toEqual(["joined", "arrived"]);
      await expect(
        caller(member).groupHistory.list({ groupId, categories: [] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    test("people outside the group can't read its history", async () => {
      await seedEvent("private", ago(minute));
      await expect(caller(outsider).groupHistory.list({ groupId })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await caller(outsider).groupHistory.latest()).toEqual([]);
    });

    test("latest counts other people's group events since you joined, not arrivals or expired ones", async () => {
      await seedEvent("beforeJoin", ago(20 * minute));
      await seedEvent("expired", ago(14 * day + minute));
      await seedEvent("byMember", ago(5 * minute), member);
      await seedTransition("ownerArrivedEarly", ago(4 * minute), owner);
      await setJoinedAt(member, ago(10 * minute));
      expect(await caller(member).groupHistory.latest()).toEqual([{ groupId, latestAt: null }]);

      await setJoinedAt(member, ago(15 * day));
      expect(await caller(member).groupHistory.latest()).toEqual([
        {
          groupId,
          latestAt: (
            await prisma.groupEvent.findFirstOrThrow({ where: { id: `${prefix}-beforeJoin` } })
          ).createdAt,
        },
      ]);
      await setJoinedAt(member, ago(10 * minute));

      const byOwner = await seedEvent("byOwner", ago(3 * minute));
      expect(await caller(member).groupHistory.latest()).toEqual([
        { groupId, latestAt: byOwner.createdAt },
      ]);
      await seedTransition("ownerArrived", ago(2 * minute), owner);
      expect(await caller(member).groupHistory.latest()).toEqual([
        { groupId, latestAt: byOwner.createdAt },
      ]);
      const byMember = await prisma.groupEvent.findFirstOrThrow({
        where: { id: `${prefix}-byMember` },
      });
      expect(await caller(owner).groupHistory.latest()).toEqual([
        { groupId, latestAt: byMember.createdAt },
      ]);
    });

    test("role changes and renames are recorded once, and unchanged saves record nothing", async () => {
      const memberRow = await prisma.groupMember.findUniqueOrThrow({
        where: { userId_groupId: { userId: member, groupId } },
      });
      await caller(owner).groupMembership.updateRole({
        groupId,
        memberId: memberRow.id,
        role: "ADMIN",
      });
      await caller(owner).groupMembership.updateRole({
        groupId,
        memberId: memberRow.id,
        role: "ADMIN",
      });
      await caller(member).groupSettings.rename({ groupId, name: "Kings" });
      await caller(member).groupSettings.rename({ groupId, name: "Kings" });
      await expect(
        caller(member).groupMembership.updateRole({
          groupId,
          memberId: memberRow.id,
          role: "OWNER",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const { items } = await caller(owner).groupHistory.list({ groupId });
      expect(items).toMatchObject([
        {
          kind: "group",
          type: "GROUP_RENAMED",
          actor: { userId: member },
          name: "Kings",
          previousName: "Family",
        },
        {
          kind: "group",
          type: "ROLE_CHANGED",
          actor: { userId: owner },
          subject: { userId: member },
          role: "ADMIN",
        },
      ]);
      expect(items).toHaveLength(2);
      await prisma.group.update({ where: { id: groupId }, data: { name: "Family" } });
    });
  },
);
