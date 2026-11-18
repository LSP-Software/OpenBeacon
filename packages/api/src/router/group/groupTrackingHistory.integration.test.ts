import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { createDeviceKeyPair } from "@openbeacon/encryption";
import { HISTORY_RETENTION_MS } from "../../lib/placeTransitions.ts";
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

const minutes = (count: number) => count * 60_000;
const ago = (ms: number) => new Date(Date.now() - ms);
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
    count = 1,
    epochNumber = 1,
    receivedAt,
    revisionPrefix = "",
    senderDeviceId = memberDeviceId,
    senderUserId = memberId,
  }: {
    count?: number;
    epochNumber?: number;
    receivedAt: Date;
    revisionPrefix?: string;
    senderDeviceId?: string;
    senderUserId?: string;
  }) =>
    storeTrackingPoints(prisma, {
      count,
      epochId: `${groupId}-epoch-${epochNumber}`,
      groupId,
      receivedAt,
      revisionPrefix,
      senderDeviceId,
      senderUserId,
    });
  return { groupId, store };
};

const readAllPages = async (
  groupId: string,
  range: { from: Date; to: Date },
  limit: number,
  userId = viewerId,
  deviceId = viewerDeviceId,
) => {
  const pages = [];
  let cursor: { pointId: string; receivedAt: Date; streamId: string } | undefined;
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

    test("historyDays counts points per device and UTC hour from the first point", async () => {
      const { groupId, store } = await createGroup("days");
      const hour = new Date(Math.floor((Date.now() - minutes(300)) / 3_600_000) * 3_600_000);
      const at = (offset: number) => new Date(hour.getTime() + minutes(offset));
      await store({ receivedAt: at(5), count: 2 });
      await store({ receivedAt: at(50) });
      await store({ receivedAt: at(70), count: 3, epochNumber: 2 });
      await store({ receivedAt: at(130), senderDeviceId: viewerDeviceId, senderUserId: viewerId });

      const days = await caller(viewerId, viewerDeviceId).historyDays({ groupId });

      expect(
        Math.abs(days.windowStart.getTime() - (Date.now() - HISTORY_RETENTION_MS)),
      ).toBeLessThan(60_000);
      expect(days.devices).toHaveLength(2);
      expect(days.devices.find((device) => device.senderDeviceId === memberDeviceId)).toEqual({
        senderUserId: memberId,
        senderDeviceId: memberDeviceId,
        firstReceivedAt: at(5),
        hours: [
          { hour, count: 3 },
          { hour: at(60), count: 3 },
        ],
      });
      expect(days.devices.find((device) => device.senderDeviceId === viewerDeviceId)).toEqual({
        senderUserId: viewerId,
        senderDeviceId: viewerDeviceId,
        firstReceivedAt: at(130),
        hours: [{ hour: at(120), count: 1 }],
      });
    });

    test("only streams from the viewer's join epoch onwards are returned", async () => {
      const { groupId, store } = await createGroup("join-cut-off");
      const oldStream = await store({ receivedAt: ago(minutes(120)), count: 2 });
      const newStream = await store({ receivedAt: ago(minutes(60)), count: 3, epochNumber: 2 });
      const range = { from: ago(minutes(180)), to: ago(minutes(30)) };

      const late = caller(lateId, lateDeviceId);
      expect((await late.historyDays({ groupId })).devices[0]?.hours).toHaveLength(1);
      expect(
        (await late.historyDays({ groupId })).devices.flatMap(({ hours }) => hours)[0]?.count,
      ).toBe(3);
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
        from: ago(minutes(90)),
        to: ago(minutes(30)),
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

    test("the 14-day window cuts off older points and clamps the range", async () => {
      const { groupId, store } = await createGroup("window");
      await store({ receivedAt: ago(HISTORY_RETENTION_MS + minutes(2)) });
      await store({ receivedAt: ago(HISTORY_RETENTION_MS - minutes(2)), count: 2 });
      const viewer = caller(viewerId, viewerDeviceId);

      const days = await viewer.historyDays({ groupId });
      expect(
        days.devices.flatMap(({ hours }) => hours).reduce((sum, { count }) => sum + count, 0),
      ).toBe(2);
      expect(days.devices[0]?.firstReceivedAt.getTime()).toBeGreaterThan(
        Date.now() - HISTORY_RETENTION_MS,
      );

      const range = await viewer.historyRange({
        groupId,
        from: ago(HISTORY_RETENTION_MS + minutes(60)),
        to: ago(HISTORY_RETENTION_MS - minutes(60)),
      });
      expect(range.points).toHaveLength(2);
      expect(range.lookback).toEqual([]);

      await expect(
        viewer.historyRange({
          groupId,
          from: ago(minutes(60 * 53)),
          to: ago(0),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        viewer.historyRange({ groupId, from: ago(0), to: ago(minutes(1)) }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    test("removed members and inactive devices are left out", async () => {
      const { groupId, store } = await createGroup("removed");
      const receivedAt = ago(minutes(60));
      const kept = await store({ receivedAt });
      await store({ receivedAt, senderDeviceId: revokedDeviceId });
      await store({ receivedAt, senderDeviceId: pendingDeviceId });
      await store({ receivedAt, senderDeviceId: removedDeviceId, senderUserId: removedId });
      await store({
        receivedAt: ago(minutes(300)),
        senderDeviceId: removedDeviceId,
        senderUserId: removedId,
      });
      await store({ receivedAt: ago(minutes(300)), senderDeviceId: revokedDeviceId });
      const viewer = caller(viewerId, viewerDeviceId);

      expect(
        (await viewer.historyDays({ groupId })).devices.map((device) => device.senderDeviceId),
      ).toEqual([memberDeviceId]);
      const range = await viewer.historyRange({
        groupId,
        from: ago(minutes(120)),
        to: ago(0),
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
      const before = await store({ receivedAt: ago(minutes(90)), count: 2 });
      const after = await store({
        receivedAt: ago(minutes(30)),
        count: 2,
        revisionPrefix: "s0.3:",
      });

      const range = await caller(viewerId, viewerDeviceId).historyRange({
        groupId,
        from: ago(minutes(120)),
        to: ago(0),
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

    test("the lookback point is each device's latest before the range, on the first page only", async () => {
      const { groupId, store } = await createGroup("lookback");
      const lookbackAt = ago(minutes(600));
      await store({ receivedAt: ago(minutes(900)) });
      const lookbackStream = await store({ receivedAt: lookbackAt, epochNumber: 2 });
      await store({ receivedAt: ago(minutes(100)), count: 3 });
      await store({
        receivedAt: ago(HISTORY_RETENTION_MS + minutes(60)),
        senderDeviceId: viewerDeviceId,
        senderUserId: viewerId,
      });
      const range = { from: ago(minutes(300)), to: ago(0) };

      const [first, second] = await readAllPages(groupId, range, 2);
      expect(first?.lookback).toEqual([
        expect.objectContaining({ receivedAt: lookbackAt, streamId: String(lookbackStream) }),
      ]);
      expect(first?.streams.map(({ id }) => id)).toContain(String(lookbackStream));
      expect(second?.lookback).toEqual([]);
      expect([...(first?.points ?? []), ...(second?.points ?? [])]).toHaveLength(3);
      for (const point of first?.lookback ?? []) {
        expect(point.nonce).toBeString();
        expect(point.ciphertext).toBeString();
      }
    });

    test("the lookback is every point of each device's last batch before the range", async () => {
      const { groupId, store } = await createGroup("lookback-batch");
      const batchAt = ago(minutes(400));
      await store({ receivedAt: ago(minutes(500)), count: 2 });
      const stayStream = await store({ receivedAt: batchAt, epochNumber: 2 });
      const movingStream = await store({ receivedAt: ago(minutes(700)) });
      await prisma.$executeRaw`
        INSERT INTO "TrackingPoint" ("streamId", "pointId", "receivedAt", "payload")
        VALUES (${movingStream}, ${-9_000_000_000_000_000_000n}, (${batchAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'), '\\x00'::bytea)
      `;
      await store({
        receivedAt: ago(minutes(450)),
        count: 120,
        senderDeviceId: viewerDeviceId,
        senderUserId: viewerId,
      });

      const range = await caller(viewerId, viewerDeviceId).historyRange({
        groupId,
        from: ago(minutes(300)),
        to: ago(0),
      });

      const memberLookback = range.lookback.filter(({ streamId }) =>
        [String(stayStream), String(movingStream)].includes(streamId),
      );
      expect(memberLookback).toHaveLength(2);
      expect(memberLookback.map(({ receivedAt }) => receivedAt)).toEqual([batchAt, batchAt]);
      expect(memberLookback.map(({ pointId }) => pointId)).toContain("-9000000000000000000");
      expect(range.lookback).toHaveLength(102);
      expect(range.streams.map(({ id }) => id)).toEqual(
        expect.arrayContaining([String(stayStream), String(movingStream)]),
      );
    });

    test("paging returns every point once in receive order", async () => {
      const { groupId, store } = await createGroup("paging");
      const tiedAt = ago(minutes(45));
      await store({ receivedAt: tiedAt, count: 7 });
      await store({ receivedAt: tiedAt, count: 6, epochNumber: 2 });
      await store({
        receivedAt: tiedAt,
        count: 4,
        senderDeviceId: viewerDeviceId,
        senderUserId: viewerId,
      });
      await store({ receivedAt: ago(minutes(50)), count: 5, revisionPrefix: "s0.1:" });
      await store({ receivedAt: ago(minutes(20)), count: 3 });
      const range = { from: ago(minutes(60)), to: ago(0) };

      const pages = await readAllPages(groupId, range, 4);
      const [whole] = await readAllPages(groupId, range, 2_000);
      const paged = pages.flatMap(({ points }) => points);

      expect(pages.length).toBeGreaterThan(5);
      expect(paged).toHaveLength(25);
      expect(new Set(paged.map(({ streamId, pointId }) => `${streamId}:${pointId}`)).size).toBe(25);
      expect(paged).toEqual(whole?.points ?? []);
      const order = paged.map(
        ({ pointId, receivedAt, streamId }) =>
          [receivedAt.getTime(), BigInt(streamId), BigInt(pointId)] as const,
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
        caller(lateId, lateDeviceId).historyRange({ groupId, from: ago(minutes(60)), to: ago(0) }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  },
);
