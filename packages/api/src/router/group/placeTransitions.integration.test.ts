import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { encodePlaceAlertsCursor } from "../../lib/placeTransitions.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";
import { placeSharingRouter } from "./placeSharingRouter.ts";
import { placeTransitionsRouter } from "./placeTransitionsRouter.ts";

const router = createTRPCRouter({
  groupTracking: groupTrackingRouter,
  placeSharing: placeSharingRouter,
  placeTransitions: placeTransitionsRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `place-transitions-${crypto.randomUUID()}`;
const owner = `${prefix}-owner`;
const member = `${prefix}-member`;
const outsider = `${prefix}-outsider`;
const users = [owner, member, outsider];
const ownerPhone = `${owner}-phone`;
const ownerTablet = `${owner}-tablet`;
const memberPhone = `${member}-phone`;
const outsiderPhone = `${outsider}-phone`;
const groupId = `${prefix}-group`;
const quietGroupId = `${prefix}-quiet`;
const otherGroupId = `${prefix}-other`;
const groupIds = [groupId, quietGroupId, otherGroupId];
const oldEpochId = `${groupId}-epoch-1`;
const latestEpochId = `${groupId}-epoch-2`;
const homeId = `${prefix}-home`;
const schoolId = `${prefix}-school`;
const otherPlaceId = `${prefix}-other-place`;
const minute = 60_000;
const day = 24 * 60 * minute;
const longAgo = new Date(Date.now() - 30 * day);

const caller = (userId: string, deviceId: string) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId,
      unverifiedDeviceId: null,
      session: { user: { id: userId }, session: { id: `${userId}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );

const transition = ({
  placeId = homeId,
  direction = "ARRIVE",
  occurredAt = new Date(Date.now() - minute),
  senderDeviceId = memberPhone,
}: {
  placeId?: string;
  direction?: "ARRIVE" | "LEAVE";
  occurredAt?: Date;
  senderDeviceId?: string;
} = {}) => ({ clientId: crypto.randomUUID(), placeId, direction, occurredAt, senderDeviceId });

const upload = (
  placeTransitions: ReturnType<typeof transition>[],
  { userId = member, deviceId = memberPhone } = {},
) => caller(userId, deviceId).groupTracking.uploadBatch({ groupId, points: [], placeTransitions });

const readAlerts = (userId: string, deviceId: string, placeAlertsCursor: string | null) =>
  caller(userId, deviceId).groupTracking.uploadBatch({
    groupId,
    points: [],
    placeTransitions: [transition({ senderDeviceId: deviceId })],
    placeAlertsCursor,
  });

const seedTransitions = (
  rows: Array<{ id: string; createdAt: Date; deviceId?: string; userId?: string }>,
) =>
  prisma.placeTransition.createMany({
    data: rows.map(({ id, createdAt, deviceId = memberPhone, userId = member }) => ({
      id,
      placeId: deviceId === outsiderPhone ? otherPlaceId : homeId,
      groupId: deviceId === outsiderPhone ? otherGroupId : groupId,
      deviceId,
      userId,
      direction: "ARRIVE" as const,
      occurredAt: createdAt,
      clientId: crypto.randomUUID(),
      createdAt,
    })),
  });

const storedCount = () => prisma.placeTransition.count({ where: { groupId } });

const setOwnerJoinedAt = (createdAt: Date) =>
  prisma.groupMember.update({
    where: { userId_groupId: { userId: owner, groupId } },
    data: { createdAt },
  });

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "place transitions with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: users.map((id) => ({ id, name: id, email: `${id}@example.test` })),
      });
      await prisma.userDevice.createMany({
        data: [
          { id: ownerPhone, userId: owner, name: "Owner phone" },
          { id: ownerTablet, userId: owner, name: "Owner tablet" },
          { id: memberPhone, userId: member, name: "Member phone" },
          { id: outsiderPhone, userId: outsider, name: "Outsider phone" },
        ].map((device) => ({
          ...device,
          activatedAt: new Date(),
          icon: "phone" as const,
          publicKey: "public-key",
          publicKeyAlgorithm: "X25519",
        })),
      });
      const members = (userIds: string[]) =>
        userIds.map((userId, index) => ({
          userId,
          role: index === 0 ? ("OWNER" as const) : ("MEMBER" as const),
          joinedEpochNumber: 1,
          createdAt: longAgo,
        }));
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Family",
          groupMembers: { create: members([owner, member]) },
          groupEpochs: {
            create: [
              { id: oldEpochId, epochNumber: 1, senderPublicKey: "public-key" },
              { id: latestEpochId, epochNumber: 2, senderPublicKey: "public-key" },
            ],
          },
        },
      });
      await prisma.group.create({
        data: {
          id: quietGroupId,
          name: "Quiet",
          groupMembers: { create: members([owner, member]) },
        },
      });
      await prisma.group.create({
        data: {
          id: otherGroupId,
          name: "Other",
          groupMembers: { create: members([outsider]) },
          groupEpochs: {
            create: [
              { id: `${otherGroupId}-epoch`, epochNumber: 1, senderPublicKey: "public-key" },
            ],
          },
        },
      });
      await prisma.place.createMany({
        data: [
          { id: homeId, groupId, epochId: latestEpochId, name: "Home" },
          { id: schoolId, groupId, epochId: latestEpochId, name: "School" },
          {
            id: otherPlaceId,
            groupId: otherGroupId,
            epochId: `${otherGroupId}-epoch`,
            name: "Away",
          },
        ].map((place) => ({
          ...place,
          emoji: "🏠",
          senderDeviceId: ownerPhone,
          algorithm: "XChaCha20-Poly1305",
          nonce: "nonce",
          ciphertext: `${place.id}-ciphertext`,
          createdByUserId: place.groupId === otherGroupId ? outsider : owner,
        })),
      });
    });

    beforeEach(async () => {
      await prisma.placeTransition.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.placeSharing.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.userDevice.updateMany({
        where: { userId: { in: users } },
        data: {
          sharingPaused: false,
          sharingPausedUntil: null,
          sharingChangedAt: null,
          sharingRevision: 0,
          revokedAt: null,
        },
      });
      await prisma.place.update({ where: { id: schoolId }, data: { epochId: latestEpochId } });
      await setOwnerJoinedAt(longAgo);
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    test("sending the same clientId twice stores one row", async () => {
      const arrival = transition();
      expect(await upload([arrival])).toMatchObject({
        accepted: [],
        placeTransitions: { accepted: [arrival.clientId], duplicates: [], discarded: [] },
      });
      expect((await upload([arrival])).placeTransitions).toEqual({
        accepted: [],
        duplicates: [arrival.clientId],
        discarded: [],
      });
      expect(await storedCount()).toBe(1);
      expect(
        await prisma.placeTransition.findFirstOrThrow({ where: { clientId: arrival.clientId } }),
      ).toMatchObject({
        placeId: homeId,
        groupId,
        deviceId: memberPhone,
        userId: member,
        direction: "ARRIVE",
        occurredAt: arrival.occurredAt,
      });
    });

    test("a batch with neither points nor transitions is refused", async () => {
      await expect(
        caller(member, memberPhone).groupTracking.uploadBatch({ groupId, points: [] }),
      ).rejects.toThrow("An upload needs at least one point or place transition");
    });

    test("discards places from another group, out-of-range times and anything while sharing is off", async () => {
      const now = Date.now();
      const otherGroupPlace = transition({ placeId: otherPlaceId });
      const unknownPlace = transition({ placeId: `${prefix}-missing` });
      const future = transition({ occurredAt: new Date(now + 10 * minute) });
      const slightlyAhead = transition({ occurredAt: new Date(now + minute) });
      const tooOld = transition({ occurredAt: new Date(now - 15 * day) });
      const kept = transition({ direction: "LEAVE", placeId: schoolId });
      const result = await upload([
        otherGroupPlace,
        unknownPlace,
        future,
        slightlyAhead,
        tooOld,
        kept,
      ]);
      expect(result.placeTransitions?.accepted.sort()).toEqual(
        [slightlyAhead.clientId, kept.clientId].sort(),
      );
      expect(result.placeTransitions?.discarded.sort()).toEqual(
        [otherGroupPlace.clientId, unknownPlace.clientId, future.clientId, tooOld.clientId].sort(),
      );

      await caller(member, memberPhone).placeSharing.set({ groupId, enabled: false });
      const switchedOff = transition();
      expect((await upload([switchedOff])).placeTransitions?.discarded).toEqual([
        switchedOff.clientId,
      ]);
      await caller(member, memberPhone).placeSharing.set({ groupId, enabled: true });

      await prisma.userDevice.update({
        where: { id: memberPhone },
        data: {
          sharingPaused: true,
          sharingChangedAt: new Date(now - 30 * minute),
          sharingRevision: 1,
        },
      });
      const paused = transition();
      expect((await upload([paused])).placeTransitions?.discarded).toEqual([paused.clientId]);

      await prisma.userDevice.update({
        where: { id: memberPhone },
        data: {
          sharingPaused: false,
          sharingChangedAt: new Date(now - 10 * minute),
          sharingRevision: 2,
        },
      });
      const recordedWhilePaused = transition({ occurredAt: new Date(now - 20 * minute) });
      const afterResume = transition({ occurredAt: new Date(now - 5 * minute) });
      expect((await upload([recordedWhilePaused, afterResume])).placeTransitions).toMatchObject({
        accepted: [afterResume.clientId],
        discarded: [recordedWhilePaused.clientId],
      });
      expect(await storedCount()).toBe(3);
    });

    test("refuses transitions from a device that isn't the caller's, a revoked device or a non-member", async () => {
      await expect(upload([transition({ senderDeviceId: ownerPhone })])).rejects.toThrow(
        "Place transitions must be sent from this device.",
      );
      await expect(
        upload([transition({ senderDeviceId: ownerTablet })], {
          userId: owner,
          deviceId: ownerPhone,
        }),
      ).rejects.toThrow("Place transitions must be sent from this device.");
      await expect(
        upload([transition({ senderDeviceId: outsiderPhone })], {
          userId: outsider,
          deviceId: outsiderPhone,
        }),
      ).rejects.toThrow("You are not a member of this group");
      await prisma.userDevice.update({
        where: { id: memberPhone },
        data: { revokedAt: new Date() },
      });
      await expect(upload([transition()])).rejects.toThrow();
      expect(await storedCount()).toBe(0);
    });

    test("only the device itself changes its switch, and the group sees which devices have it off", async () => {
      expect(await caller(member, memberPhone).placeSharing.get({ groupId })).toEqual({
        enabled: true,
        arrivalsOff: [],
      });
      expect(
        await caller(owner, ownerTablet).placeSharing.set({ groupId, enabled: false }),
      ).toEqual({ enabled: false });
      expect(await caller(owner, ownerPhone).placeSharing.get({ groupId })).toEqual({
        enabled: true,
        arrivalsOff: [{ userId: owner, deviceId: ownerTablet }],
      });
      expect(await caller(owner, ownerTablet).placeSharing.get({ groupId })).toMatchObject({
        enabled: false,
      });
      expect(await caller(owner, ownerTablet).placeSharing.get({ groupId: quietGroupId })).toEqual({
        enabled: true,
        arrivalsOff: [],
      });
      await expect(
        caller(outsider, outsiderPhone).placeSharing.set({ groupId, enabled: false }),
      ).rejects.toThrow("You are not a member of this group");
    });

    test("upload responses carry place updates only when the phone asks for them", async () => {
      const plain = await upload([transition()]);
      expect(plain).not.toHaveProperty("places");
      expect(plain).not.toHaveProperty("placeAlerts");

      const started = Date.now();
      const first = await readAlerts(owner, ownerPhone, null);
      expect(first.places).toEqual([{ groupId, revision: 0, needsCatchUp: false }]);
      expect(first.placeAlerts?.alerts).toEqual([]);
      const cursorTime = Date.parse(first.placeAlerts?.cursor.split("|")[0] ?? "");
      expect(cursorTime).toBeGreaterThanOrEqual(started - 16_000);
      expect(cursorTime).toBeLessThanOrEqual(Date.now() - 14_000);

      await prisma.place.update({ where: { id: schoolId }, data: { epochId: oldEpochId } });
      const later = await readAlerts(owner, ownerPhone, first.placeAlerts?.cursor ?? null);
      expect(later.places).toEqual([{ groupId, revision: 0, needsCatchUp: true }]);
    });

    test("place alerts skip the caller's own devices, follow the cursor and stop at 50", async () => {
      const base = Date.now() - 10 * minute;
      await seedTransitions([
        ...Array.from({ length: 52 }, (_, index) => ({
          id: `${prefix}-alert-${String(index).padStart(2, "0")}`,
          createdAt: new Date(base + index * 1_000),
        })),
        {
          id: `${prefix}-own-phone`,
          createdAt: new Date(base),
          deviceId: ownerPhone,
          userId: owner,
        },
        {
          id: `${prefix}-own-tablet`,
          createdAt: new Date(base),
          deviceId: ownerTablet,
          userId: owner,
        },
        {
          id: `${prefix}-other-group`,
          createdAt: new Date(base),
          deviceId: outsiderPhone,
          userId: outsider,
        },
        { id: `${prefix}-unsettled`, createdAt: new Date(Date.now() - 1_000) },
      ]);
      const start = encodePlaceAlertsCursor({ createdAt: new Date(base - 1_000), id: "" });
      const firstPage = await readAlerts(owner, ownerPhone, start);
      expect(firstPage.placeAlerts?.alerts).toHaveLength(50);
      expect(firstPage.placeAlerts?.alerts[0]).toEqual({
        id: `${prefix}-alert-00`,
        groupId,
        placeId: homeId,
        placeName: "Home",
        placeEmoji: "🏠",
        direction: "ARRIVE",
        occurredAt: new Date(base),
        userId: member,
        deviceId: memberPhone,
        deviceName: "Member phone",
      });
      expect(firstPage.placeAlerts?.alerts.every(({ userId }) => userId === member)).toBe(true);

      const secondPage = await readAlerts(owner, ownerPhone, firstPage.placeAlerts?.cursor ?? "");
      expect(secondPage.placeAlerts?.alerts.map(({ id }) => id)).toEqual([
        `${prefix}-alert-50`,
        `${prefix}-alert-51`,
      ]);
      const lastCursor = secondPage.placeAlerts?.cursor ?? "";
      expect((await readAlerts(owner, ownerPhone, lastCursor)).placeAlerts).toEqual({
        alerts: [],
        cursor: lastCursor,
      });

      const memberView = await readAlerts(member, memberPhone, start);
      expect(memberView.placeAlerts?.alerts.map(({ id }) => id).sort()).toEqual(
        [`${prefix}-own-phone`, `${prefix}-own-tablet`].sort(),
      );
    });

    test("place alerts and history leave out what happened before the reader joined", async () => {
      const joined = new Date(Date.now() - 2 * day);
      await setOwnerJoinedAt(joined);
      await seedTransitions([
        { id: `${prefix}-before-join`, createdAt: new Date(joined.getTime() - day) },
        { id: `${prefix}-after-join`, createdAt: new Date(joined.getTime() + 1.5 * day) },
      ]);
      const page = await readAlerts(
        owner,
        ownerPhone,
        encodePlaceAlertsCursor({ createdAt: new Date(0), id: "" }),
      );
      expect(page.placeAlerts?.alerts.map(({ id }) => id)).toEqual([`${prefix}-after-join`]);
      const recent = await caller(owner, ownerPhone).placeTransitions.recent({ groupId });
      const recentIds = recent.transitions.map(({ id }) => id);
      expect(recentIds).toContain(`${prefix}-after-join`);
      expect(recentIds).not.toContain(`${prefix}-before-join`);
    });

    test("place alerts leave out anything that happened more than 24 hours ago", async () => {
      const now = Date.now();
      await seedTransitions([
        { id: `${prefix}-two-days`, createdAt: new Date(now - 2 * day) },
        { id: `${prefix}-a-day`, createdAt: new Date(now - day - minute) },
        { id: `${prefix}-today`, createdAt: new Date(now - day + minute) },
      ]);
      await prisma.placeTransition.create({
        data: {
          id: `${prefix}-uploaded-late`,
          placeId: homeId,
          groupId,
          deviceId: memberPhone,
          userId: member,
          direction: "LEAVE",
          occurredAt: new Date(now - 3 * day),
          clientId: crypto.randomUUID(),
          createdAt: new Date(now - minute),
        },
      });
      const page = await readAlerts(
        owner,
        ownerPhone,
        encodePlaceAlertsCursor({ createdAt: new Date(now - 3 * day), id: "" }),
      );
      expect(page.placeAlerts?.alerts.map(({ id }) => id)).toEqual([`${prefix}-today`]);
      const recent = await caller(owner, ownerPhone).placeTransitions.recent({ groupId });
      expect(
        recent.transitions.filter(({ userId }) => userId === member).map(({ id }) => id),
      ).toEqual([
        `${prefix}-today`,
        `${prefix}-a-day`,
        `${prefix}-two-days`,
        `${prefix}-uploaded-late`,
      ]);
    });

    test("recent returns the last 14 days newest first, in pages, for members only", async () => {
      const now = Date.now();
      await seedTransitions([
        { id: `${prefix}-expired`, createdAt: new Date(now - 15 * day) },
        ...Array.from({ length: 101 }, (_, index) => ({
          id: `${prefix}-recent-${String(index).padStart(3, "0")}`,
          createdAt: new Date(now - day + index * minute),
        })),
      ]);
      const first = await caller(member, memberPhone).placeTransitions.recent({ groupId });
      expect(first.transitions).toHaveLength(100);
      expect(first.transitions[0]?.id).toBe(`${prefix}-recent-100`);
      if (!first.nextBefore) throw new Error("Expected a second page");
      expect(
        await caller(member, memberPhone).placeTransitions.recent({
          groupId,
          before: first.nextBefore,
        }),
      ).toEqual({
        transitions: [expect.objectContaining({ id: `${prefix}-recent-000` })],
        nextBefore: null,
      });
      await expect(
        caller(outsider, outsiderPhone).placeTransitions.recent({ groupId }),
      ).rejects.toThrow("You are not a member of this group");
    });

    test("leaving a group removes the device's switch for it", async () => {
      await caller(member, memberPhone).placeSharing.set({ groupId: quietGroupId, enabled: false });
      await prisma.groupMember.delete({
        where: { userId_groupId: { userId: member, groupId: quietGroupId } },
      });
      expect(await prisma.placeSharing.count({ where: { deviceId: memberPhone } })).toBe(0);
    });
  },
);
