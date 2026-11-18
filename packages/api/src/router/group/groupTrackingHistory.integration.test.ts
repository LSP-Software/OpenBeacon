import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { createDeviceKeyPair } from "@openbeacon/encryption";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { storeTrackingPoints } from "../../lib/trackingPoints.testUtil.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";

const prefix = `tracking-history-${crypto.randomUUID()}`;
const viewerId = `${prefix}-viewer`;
const memberId = `${prefix}-member`;
const lateId = `${prefix}-late`;
const removedId = `${prefix}-removed`;
const viewerDeviceId = `${prefix}-viewer-device`;
const memberDeviceId = `${prefix}-member-device`;
const revokedDeviceId = `${prefix}-revoked-device`;
const pendingDeviceId = `${prefix}-pending-device`;
const lateDeviceId = `${prefix}-late-device`;
const removedDeviceId = `${prefix}-removed-device`;
const senderPublicKey = createDeviceKeyPair().publicKey;
const cache = createIntegrationTestCache(() => 0);
const router = createTRPCRouter({ groupTracking: groupTrackingRouter });
const caller = (userId: string, deviceId: string) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId,
      session: { user: { id: userId }, session: { id: `${userId}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  ).groupTracking;

const HOUR_MS = 3_600_000;
const RETENTION_HOURS = 336;
const nowHour = () => Math.floor(Date.now() / HOUR_MS);
const groupIds: string[] = [];

const createGroup = async (name: string, lateJoinedEpochNumber = 2) => {
  const groupId = `${prefix}-${name}`;
  groupIds.push(groupId);
  await prisma.group.create({
    data: {
      id: groupId,
      name,
      groupMembers: {
        create: [
          { userId: viewerId, role: "OWNER", joinedEpochNumber: 1 },
          { userId: memberId, role: "MEMBER", joinedEpochNumber: 1 },
          { userId: lateId, role: "MEMBER", joinedEpochNumber: lateJoinedEpochNumber },
        ],
      },
    },
  });
  await prisma.groupEpoch.createMany({
    data: [1, 2].map((epochNumber) => ({
      id: `${groupId}-epoch-${epochNumber}`,
      groupId,
      epochNumber,
      createdByDeviceId: viewerDeviceId,
      senderPublicKey,
    })),
  });
  const store = ({
    capturedHour,
    count = 1,
    epochNumber = 1,
    receivedHour = capturedHour,
    revisionPrefix = "",
    senderDeviceId = memberDeviceId,
    senderUserId = memberId,
  }: {
    capturedHour: number;
    count?: number;
    epochNumber?: number;
    receivedHour?: number;
    revisionPrefix?: string;
    senderDeviceId?: string;
    senderUserId?: string;
  }) =>
    storeTrackingPoints(prisma, {
      capturedHour,
      count,
      epochId: `${groupId}-epoch-${epochNumber}`,
      groupId,
      receivedHour,
      revisionPrefix,
      senderDeviceId,
      senderUserId,
    });
  return { groupId, store };
};

const readAllPages = async (
  groupId: string,
  range: { fromHour: number; toHour: number },
  limit: number,
  userId = viewerId,
  deviceId = viewerDeviceId,
) => {
  const pages = [];
  let cursor: { capturedHour: number; pointId: string; streamId: string } | undefined;
  for (;;) {
    const page = await caller(userId, deviceId).historyRange({
      groupId,
      ...range,
      limit,
      ...(cursor ? { cursor } : {}),
    });
    pages.push(page);
    if (!page.hasMore || !page.cursor) return pages;
    cursor = page.cursor;
  }
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "tracking history with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: [viewerId, memberId, lateId, removedId].map((id) => ({
          id,
          name: id,
          email: `${id}@example.test`,
        })),
      });
      await prisma.userDevice.createMany({
        data: [
          { id: viewerDeviceId, userId: viewerId, activatedAt: new Date() },
          { id: memberDeviceId, userId: memberId, activatedAt: new Date() },
          {
            id: revokedDeviceId,
            userId: memberId,
            activatedAt: new Date(),
            revokedAt: new Date(),
          },
          { id: pendingDeviceId, userId: memberId, activatedAt: null },
          { id: lateDeviceId, userId: lateId, activatedAt: new Date() },
          { id: removedDeviceId, userId: removedId, activatedAt: new Date() },
        ].map((device) => ({
          ...device,
          publicKey: createDeviceKeyPair().publicKey,
          publicKeyAlgorithm: "X25519",
          name: "Phone",
          icon: "phone" as const,
        })),
      });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
      await prisma.user.deleteMany({
        where: { id: { in: [viewerId, memberId, lateId, removedId] } },
      });
      await prisma.$disconnect();
    });

    test("historyDays counts points per device and recorded hour from the first one", async () => {
      const { groupId, store } = await createGroup("days");
      const hour = nowHour() - 5;
      await store({ capturedHour: hour, count: 2 });
      await store({ capturedHour: hour, receivedHour: hour + 1 });
      await store({ capturedHour: hour + 1, count: 3, epochNumber: 2 });
      await store({ capturedHour: hour - 30, receivedHour: hour + 4 });
      await store({
        capturedHour: hour + 2,
        senderDeviceId: viewerDeviceId,
        senderUserId: viewerId,
      });

      const days = await caller(viewerId, viewerDeviceId).historyDays({ groupId });

      expect(days.windowStart.getTime()).toBe((nowHour() - RETENTION_HOURS) * HOUR_MS);
      expect(days.devices).toHaveLength(2);
      expect(days.devices.find((device) => device.senderDeviceId === memberDeviceId)).toEqual({
        senderUserId: memberId,
        senderDeviceId: memberDeviceId,
        firstHour: hour - 30,
        hours: [
          { hour: hour - 30, count: 1 },
          { hour, count: 3 },
          { hour: hour + 1, count: 3 },
        ],
      });
      expect(days.devices.find((device) => device.senderDeviceId === viewerDeviceId)).toEqual({
        senderUserId: viewerId,
        senderDeviceId: viewerDeviceId,
        firstHour: hour + 2,
        hours: [{ hour: hour + 2, count: 1 }],
      });
    });

    test("a late upload is read with the hours it was recorded in, not when it arrived", async () => {
      const { groupId, store } = await createGroup("late-upload");
      const recorded = nowHour() - 40;
      const late = await store({ capturedHour: recorded, count: 4, receivedHour: nowHour() });
      const onTime = await store({ capturedHour: nowHour(), epochNumber: 2 });
      const viewer = caller(viewerId, viewerDeviceId);

      const dayOfRecording = await viewer.historyRange({
        groupId,
        fromHour: recorded - 10,
        toHour: recorded + 10,
      });
      expect(dayOfRecording.points.map(({ streamId }) => streamId)).toEqual(
        Array(4).fill(String(late)),
      );
      expect(dayOfRecording.points.every(({ capturedHour }) => capturedHour === recorded)).toBe(
        true,
      );
      expect(dayOfRecording.lookback).toEqual([]);

      const today = await viewer.historyRange({
        groupId,
        fromHour: nowHour() - 2,
        toHour: nowHour() + 2,
      });
      expect(today.points.map(({ streamId }) => streamId)).toEqual([String(onTime)]);
      expect(today.lookback.map(({ capturedHour }) => capturedHour)).toEqual(
        Array(4).fill(recorded),
      );
    });

    test("only streams from the viewer's join epoch onwards are returned", async () => {
      const { groupId, store } = await createGroup("join-cut-off");
      const oldStream = await store({ capturedHour: nowHour() - 2, count: 2 });
      const newStream = await store({ capturedHour: nowHour() - 1, count: 3, epochNumber: 2 });
      const range = { fromHour: nowHour() - 3, toHour: nowHour() };

      const late = caller(lateId, lateDeviceId);
      expect((await late.historyDays({ groupId })).devices[0]?.hours).toEqual([
        { hour: nowHour() - 1, count: 3 },
      ]);
      const lateRange = await late.historyRange({ groupId, ...range });
      expect(lateRange.points.map(({ streamId }) => streamId)).toEqual(
        Array(3).fill(String(newStream)),
      );
      expect(lateRange.streams).toEqual([
        {
          id: String(newStream),
          senderUserId: memberId,
          senderDeviceId: memberDeviceId,
          epochId: `${groupId}-epoch-2`,
          epochNumber: 2,
          revisionPrefix: "",
        },
      ]);
      const lateLookback = await late.historyRange({
        groupId,
        fromHour: nowHour() - 1,
        toHour: nowHour(),
      });
      expect(lateLookback.lookback).toEqual([]);

      const viewerRange = await caller(viewerId, viewerDeviceId).historyRange({
        groupId,
        ...range,
      });
      expect(viewerRange.points.map(({ streamId }) => streamId)).toEqual([
        ...Array(2).fill(String(oldStream)),
        ...Array(3).fill(String(newStream)),
      ]);
    });

    test("the 14-day window goes by arrival and ranges are at most 26 hours", async () => {
      const { groupId, store } = await createGroup("window");
      const windowHour = nowHour() - RETENTION_HOURS;
      await store({ capturedHour: windowHour - 1 });
      await store({ capturedHour: windowHour, count: 2 });
      await store({ capturedHour: windowHour - 5, receivedHour: windowHour + 300, count: 3 });
      const viewer = caller(viewerId, viewerDeviceId);

      const days = await viewer.historyDays({ groupId });
      expect(days.devices[0]?.hours).toEqual([
        { hour: windowHour - 5, count: 3 },
        { hour: windowHour, count: 2 },
      ]);

      const range = await viewer.historyRange({
        groupId,
        fromHour: windowHour - 10,
        toHour: windowHour + 10,
      });
      expect(range.points.map(({ capturedHour }) => capturedHour)).toEqual([
        windowHour - 5,
        windowHour - 5,
        windowHour - 5,
        windowHour,
        windowHour,
      ]);
      expect(range.lookback).toEqual([]);

      await expect(
        viewer.historyRange({ groupId, fromHour: nowHour() - 26, toHour: nowHour() }),
      ).resolves.toBeDefined();
      await expect(
        viewer.historyRange({ groupId, fromHour: nowHour() - 27, toHour: nowHour() }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        viewer.historyRange({ groupId, fromHour: nowHour(), toHour: nowHour() }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    test("removed members and inactive devices are left out", async () => {
      const { groupId, store } = await createGroup("removed");
      const capturedHour = nowHour() - 1;
      const kept = await store({ capturedHour });
      await store({ capturedHour, senderDeviceId: revokedDeviceId });
      await store({ capturedHour, senderDeviceId: pendingDeviceId });
      await store({ capturedHour, senderDeviceId: removedDeviceId, senderUserId: removedId });
      await store({
        capturedHour: nowHour() - 5,
        senderDeviceId: removedDeviceId,
        senderUserId: removedId,
      });
      await store({ capturedHour: nowHour() - 5, senderDeviceId: revokedDeviceId });
      const viewer = caller(viewerId, viewerDeviceId);

      expect(
        (await viewer.historyDays({ groupId })).devices.map((device) => device.senderDeviceId),
      ).toEqual([memberDeviceId]);
      const range = await viewer.historyRange({
        groupId,
        fromHour: nowHour() - 2,
        toHour: nowHour() + 1,
      });
      expect(range.points.map(({ streamId }) => streamId)).toEqual([String(kept)]);
      expect(range.streams.map(({ id }) => id)).toEqual([String(kept)]);
      expect(range.lookback).toEqual([]);
    });

    test("points from older sharing revisions are kept", async () => {
      const { groupId, store } = await createGroup("revisions");
      await prisma.userDevice.update({
        where: { id: memberDeviceId },
        data: { sharingRevision: 3 },
      });
      const before = await store({ capturedHour: nowHour() - 2, count: 2 });
      const after = await store({
        capturedHour: nowHour() - 1,
        count: 2,
        revisionPrefix: "s0.3:",
      });

      const range = await caller(viewerId, viewerDeviceId).historyRange({
        groupId,
        fromHour: nowHour() - 2,
        toHour: nowHour() + 1,
      });
      expect(range.points.map(({ streamId }) => streamId)).toEqual([
        String(before),
        String(before),
        String(after),
        String(after),
      ]);
      expect(range.streams.map(({ revisionPrefix }) => revisionPrefix)).toEqual(["", "s0.3:"]);
      expect(
        (await caller(viewerId, viewerDeviceId).historyDays({ groupId })).devices[0]?.hours.reduce(
          (sum, { count }) => sum + count,
          0,
        ),
      ).toBe(4);
    });

    test("the lookback is each device's last recorded hour before the range, on the first page only", async () => {
      const { groupId, store } = await createGroup("lookback");
      const lookbackHour = nowHour() - 10;
      await store({ capturedHour: nowHour() - 15 });
      const lookbackStream = await store({ capturedHour: lookbackHour, epochNumber: 2 });
      await store({ capturedHour: nowHour() - 2, count: 3 });
      await store({
        capturedHour: nowHour() - RETENTION_HOURS - 1,
        senderDeviceId: viewerDeviceId,
        senderUserId: viewerId,
      });
      const range = { fromHour: nowHour() - 5, toHour: nowHour() + 1 };

      const [first, second] = await readAllPages(groupId, range, 2);
      expect(first?.lookback).toEqual([
        expect.objectContaining({ capturedHour: lookbackHour, streamId: String(lookbackStream) }),
      ]);
      expect(first?.streams.map(({ id }) => id)).toContain(String(lookbackStream));
      expect(second?.lookback).toEqual([]);
      expect([...(first?.points ?? []), ...(second?.points ?? [])]).toHaveLength(3);
      for (const point of first?.lookback ?? []) {
        expect(point.nonce).toBeString();
        expect(point.ciphertext).toBeString();
      }
    });

    test("the lookback takes every stream's points in that hour, up to 100 per device", async () => {
      const { groupId, store } = await createGroup("lookback-hour");
      const lastHour = nowHour() - 7;
      await store({ capturedHour: nowHour() - 9, count: 2 });
      const stayStream = await store({ capturedHour: lastHour, epochNumber: 2 });
      const movingStream = await store({ capturedHour: nowHour() - 12 });
      await prisma.$executeRaw`
        INSERT INTO "TrackingPoint" ("streamId", "pointId", "receivedHour", "capturedHour", "payload")
        VALUES (${movingStream}, ${-9_000_000_000_000_000_000n}, ${lastHour}, ${lastHour}, '\\x00'::bytea)
      `;
      await store({
        capturedHour: nowHour() - 8,
        count: 120,
        senderDeviceId: viewerDeviceId,
        senderUserId: viewerId,
      });

      const range = await caller(viewerId, viewerDeviceId).historyRange({
        groupId,
        fromHour: nowHour() - 5,
        toHour: nowHour() + 1,
      });

      const memberLookback = range.lookback.filter(({ streamId }) =>
        [String(stayStream), String(movingStream)].includes(streamId),
      );
      expect(memberLookback).toHaveLength(2);
      expect(memberLookback.map(({ capturedHour }) => capturedHour)).toEqual([lastHour, lastHour]);
      expect(memberLookback.map(({ pointId }) => pointId)).toContain("-9000000000000000000");
      expect(range.lookback).toHaveLength(102);
      expect(range.streams.map(({ id }) => id)).toEqual(
        expect.arrayContaining([String(stayStream), String(movingStream)]),
      );
    });

    test("paging returns every point once in recorded-hour order, across hours", async () => {
      const { groupId, store } = await createGroup("paging");
      const tiedHour = nowHour() - 2;
      await store({ capturedHour: tiedHour, count: 7 });
      await store({ capturedHour: tiedHour, count: 6, epochNumber: 2 });
      await store({
        capturedHour: tiedHour,
        count: 4,
        senderDeviceId: viewerDeviceId,
        senderUserId: viewerId,
      });
      await store({ capturedHour: tiedHour - 1, count: 5, revisionPrefix: "s0.1:" });
      await store({ capturedHour: tiedHour + 1, count: 3, receivedHour: tiedHour + 2 });
      const range = { fromHour: tiedHour - 1, toHour: nowHour() + 1 };

      const pages = await readAllPages(groupId, range, 4);
      const [whole] = await readAllPages(groupId, range, 2_000);
      const paged = pages.flatMap(({ points }) => points);

      expect(pages.length).toBeGreaterThan(5);
      expect(new Set(pages.map(({ cursor }) => cursor?.capturedHour)).size).toBe(3);
      expect(paged).toHaveLength(25);
      expect(new Set(paged.map(({ streamId, pointId }) => `${streamId}:${pointId}`)).size).toBe(25);
      expect(paged).toEqual(whole?.points ?? []);
      const order = paged.map(
        ({ capturedHour, pointId, streamId }) =>
          [capturedHour, BigInt(streamId), BigInt(pointId)] as const,
      );
      const sorted = [...order].sort((first, second) =>
        first[0] !== second[0]
          ? first[0] - second[0]
          : first[1] !== second[1]
            ? Number(first[1] - second[1])
            : Number(first[2] - second[2]),
      );
      expect(order).toEqual(sorted);
    });

    test("a non-member cannot read a group's history", async () => {
      const { groupId } = await createGroup("outsider");
      await prisma.groupMember.deleteMany({ where: { groupId, userId: lateId } });
      await expect(caller(lateId, lateDeviceId).historyDays({ groupId })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller(lateId, lateDeviceId).historyRange({
          groupId,
          fromHour: nowHour() - 1,
          toHour: nowHour(),
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  },
);
