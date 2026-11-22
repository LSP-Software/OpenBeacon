import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  decodeTrackingPoint,
  decryptGroupPayload,
  encodeTrackingPoint,
  generateGroupEpochKey,
  PAYLOAD_ENCRYPTION_ALGORITHM,
} from "@openbeacon/encryption";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import { DevicePendingError } from "../../lib/deviceActivation.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { authRouter } from "../authRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import {
  encryptedTrackingPoint,
  pointIdOf,
  storeLatestTrackingPoint,
  testClientPointId,
} from "../../lib/trackingPoints.testUtil.ts";

const prefix = `tracking-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const epochId = `${prefix}-epoch`;
const ownerId = `${prefix}-owner`;
const memberId = `${prefix}-member`;
const outsiderId = `${prefix}-outsider`;
const ownerDeviceId = `${prefix}-owner-device`;
const memberDeviceId = `${prefix}-member-device`;
const outsiderDeviceId = `${prefix}-outsider-device`;
const deviceKey = createDeviceKeyPair();
const epochKey = generateGroupEpochKey();
const cache = createIntegrationTestCache(() => 0);
const router = createTRPCRouter({
  auth: authRouter,
  groupMembership: groupMembershipRouter,
  groupTracking: groupTrackingRouter,
});
const caller = (userId: string, deviceId: string | null = null) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      deviceId,
      session: { user: { id: userId }, session: { id: `${userId}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("tracking with PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [ownerId, memberId, outsiderId].map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
      })),
    });
    await prisma.userDevice.create({
      data: {
        id: ownerDeviceId,
        userId: ownerId,
        publicKey: deviceKey.publicKey,
        publicKeyAlgorithm: "X25519",
        name: "Phone",
        icon: "phone",
        activatedAt: new Date(),
      },
    });
    await prisma.userDevice.createMany({
      data: [
        { id: memberDeviceId, userId: memberId },
        { id: outsiderDeviceId, userId: outsiderId },
      ].map((device) => ({
        ...device,
        publicKey: createDeviceKeyPair().publicKey,
        publicKeyAlgorithm: "X25519",
        name: "Phone",
        icon: "phone" as const,
        activatedAt: new Date(),
      })),
    });
    await prisma.group.create({
      data: {
        id: groupId,
        name: "Tracking test",
        groupMembers: {
          create: [
            { userId: ownerId, role: "OWNER", joinedEpochNumber: 1 },
            { userId: memberId, role: "MEMBER", joinedEpochNumber: 1 },
          ],
        },
      },
    });
    await prisma.groupEpoch.create({
      data: {
        id: epochId,
        groupId,
        epochNumber: 1,
        createdByDeviceId: ownerDeviceId,
        senderPublicKey: deviceKey.publicKey,
      },
    });
  });

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { id: groupId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, memberId, outsiderId] } },
    });
    await prisma.$disconnect();
  });

  test("device registration cannot cross an account change", async () => {
    const otherDeviceId = `${prefix}-registration-race`;
    const key = createDeviceKeyPair();
    const input = {
      algorithm: key.algorithm,
      deviceId: otherDeviceId,
      publicKey: key.publicKey,
      expectedUserId: ownerId,
    };
    await expect(caller(memberId).auth.registerDeviceKey(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await prisma.userDevice.findUnique({ where: { id: otherDeviceId } })).toBeNull();
    await expect(
      caller(ownerId).auth.registerDeviceKey({
        ...input,
        publicKey: `${key.publicKey.slice(0, 4)}${" ".repeat(1_000_000)}${key.publicKey.slice(4)}`,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.userDevice.findUnique({ where: { id: otherDeviceId } })).toBeNull();
    await caller(ownerId).auth.registerDeviceKey(input);
    expect(
      (
        await prisma.userDevice.findUniqueOrThrow({
          where: { id: otherDeviceId },
        })
      ).userId,
    ).toBe(ownerId);
  });

  const point = (
    seed: string,
    overrides: Partial<Parameters<typeof encryptedTrackingPoint>[0]> = {},
  ) =>
    encryptedTrackingPoint({
      clientPointId: testClientPointId(`${prefix}-${seed}`),
      epochId,
      epochKey,
      groupId,
      senderDeviceId: ownerDeviceId,
      ...overrides,
    });
  const upload = (points: ReturnType<typeof point>[]) =>
    caller(ownerId, ownerDeviceId).groupTracking.uploadBatch({
      groupId,
      points,
    });
  const storedPoints = () =>
    prisma.$queryRaw<
      Array<{ capturedHour: number; payload: Uint8Array; pointId: bigint; receivedHour: number }>
    >`
      SELECT "point"."payload", "point"."pointId", "point"."receivedHour", "point"."capturedHour"
      FROM "TrackingPoint" AS "point"
      JOIN "TrackingStream" AS "stream" ON "stream"."id" = "point"."streamId"
      WHERE "stream"."groupId" = ${groupId}
      ORDER BY "point"."capturedHour", "point"."pointId"
    `;
  const clearPoints = () => prisma.trackingStream.deleteMany({ where: { groupId } });

  test("stores opaque ciphertext once, authorizes the sender and rejects malformed input", async () => {
    const trackingPoint = {
      latitude: 51.5074,
      longitude: -0.1278,
      time: Date.UTC(2026, 10, 16, 12),
      stayUntil: null,
      accuracy: 8,
      speed: 1.4,
      battery: { level: 64, charging: false },
    };
    const payload = encodeTrackingPoint(trackingPoint);
    const first = point("point", { payload });
    const accepted = await upload([first]);
    expect(accepted.accepted).toEqual([first.clientPointId]);
    expect(
      (
        await prisma.userDevice.findUniqueOrThrow({
          where: { id: ownerDeviceId },
        })
      ).lastLocationAt,
    ).toBeInstanceOf(Date);
    const duplicate = await upload([point("point", { payload })]);
    expect(duplicate.duplicates).toEqual([first.clientPointId]);
    expect(duplicate.accepted).toEqual([]);

    const stored = await storedPoints();
    expect(stored).toHaveLength(1);
    expect(Buffer.from(stored[0]!.payload)).toEqual(
      Buffer.concat([Buffer.from(first.nonce, "base64"), Buffer.from(first.ciphertext, "base64")]),
    );
    expect(stored[0]!.pointId).toBe(Buffer.from(first.clientPointId, "base64").readBigInt64BE());
    expect(Buffer.from(stored[0]!.payload).includes(Buffer.from(payload))).toBe(false);

    const received = await caller(memberId, memberDeviceId).groupTracking.getLatest({ groupId });
    expect(received.points).toHaveLength(1);
    expect(received.points[0]).toMatchObject({
      ciphertext: first.ciphertext,
      epochId,
      nonce: first.nonce,
      revisionPrefix: "",
      senderDeviceId: ownerDeviceId,
      senderUserId: ownerId,
    });
    expect(
      decodeTrackingPoint(
        decryptGroupPayload({
          epochKey,
          encryptedPayload: {
            algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
            ciphertext: received.points[0]!.ciphertext,
            createdAt: received.points[0]!.updatedAt,
            epochId,
            groupId,
            kind: TRACKING_POINT_KIND,
            nonce: received.points[0]!.nonce,
            senderDeviceId: ownerDeviceId,
          },
          expectedMetadata: {
            groupId,
            epochId,
            kind: TRACKING_POINT_KIND,
            senderDeviceId: ownerDeviceId,
          },
        }).bytes.expose(),
      ),
    ).toEqual(trackingPoint);

    await expect(
      caller(memberId, memberDeviceId).groupTracking.uploadBatch({
        groupId,
        points: [{ ...first, clientPointId: testClientPointId(`${prefix}-forged`) }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(outsiderId, outsiderDeviceId).groupTracking.poll({ groupId }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "You are not a member of this group",
    });
    for (const input of [
      { ...first, nonce: `${" ".repeat(1_000_000)}${first.nonce}` },
      { ...first, ciphertext: "x".repeat(1025) },
      { ...first, ciphertext: point("padded", { payload: new Uint8Array(24) }).ciphertext },
      { ...first, ciphertext: point("short", { payload: new Uint8Array(22) }).ciphertext },
      { ...first, ciphertext: "not base64!" },
      { ...first, clientPointId: "x".repeat(200_000) },
      { ...first, clientPointId: Buffer.alloc(32, 1).toString("base64") },
      { ...first, clientPointId: `s1:${testClientPointId("bad-prefix")}` },
      { ...first, role: "TRAIL" as "POINT" },
    ]) {
      await expect(upload([input])).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    const twice = point("twice");
    await expect(upload([twice, { ...twice, role: "LIVE" }])).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await storedPoints()).toHaveLength(1);
    await clearPoints();
  });

  test("files each point under its recorded hour, clamped to the arrival window", async () => {
    const nowHour = Math.floor(Date.now() / 3_600_000);
    const sent = [
      point("hour-missing"),
      point("hour-late", { capturedHour: nowHour - 30 }),
      point("hour-too-old", { capturedHour: nowHour - 800 }),
      point("hour-ahead", { capturedHour: nowHour + 1 }),
      point("hour-too-far-ahead", { capturedHour: nowHour + 5 }),
      point("hour-stay-too-old", { capturedHour: nowHour - 900, role: "STAY" }),
    ];
    expect((await upload(sent)).accepted).toHaveLength(sent.length);
    const stored = new Map(
      (await storedPoints()).map((row) => [
        row.pointId.toString(),
        { offset: row.capturedHour - row.receivedHour, receivedHour: row.receivedHour },
      ]),
    );
    const offsetOf = (sentPoint: (typeof sent)[number]) =>
      stored.get(pointIdOf(sentPoint.clientPointId))?.offset;
    expect(sent.map(offsetOf)).toEqual([0, -30, -720, 1, 1, -720]);
    for (const { receivedHour } of stored.values()) {
      expect(Math.abs(receivedHour - nowHour)).toBeLessThanOrEqual(1);
    }
    await expect(
      upload([point("hour-not-whole", { capturedHour: nowHour + 0.5 })]),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await clearPoints();
  });

  test("stays update their point in place and live rows only move the latest point", async () => {
    const arrivalHour = Math.floor(Date.now() / 3_600_000) - 3;
    const stay = (marker: number, capturedHour = arrivalHour + marker) =>
      point("stay", { capturedHour, role: "STAY", payload: new Uint8Array(23).fill(marker) });
    const firstStay = stay(1, arrivalHour);
    expect((await upload([firstStay])).accepted).toEqual([firstStay.clientPointId]);
    await prisma.$executeRaw`
      UPDATE "TrackingPoint" SET "receivedHour" = "receivedHour" - 2
      WHERE "streamId" IN (SELECT id FROM "TrackingStream" WHERE "groupId" = ${groupId})
    `;
    const [arrival] = await storedPoints();
    expect(arrival!.capturedHour).toBe(arrivalHour);
    expect(
      await caller(memberId, memberDeviceId).groupTracking.getLatest({
        groupId,
      }),
    ).toMatchObject({ points: [] });

    const update = stay(2);
    expect(await upload([update])).toMatchObject({
      accepted: [update.clientPointId],
      duplicates: [],
    });
    const [updated] = await storedPoints();
    expect(Buffer.from(updated!.payload).subarray(0, 24)).toEqual(
      Buffer.from(update.nonce, "base64"),
    );
    expect(updated!.receivedHour).toBe(arrival!.receivedHour);
    expect(updated!.capturedHour).toBe(arrivalHour);
    expect(updated!.pointId).toBe(arrival!.pointId);

    const live = point("live", { role: "LIVE" });
    const history = point("history");
    const laterLive = point("later-live", { role: "LIVE" });
    expect((await upload([history, live, update, laterLive])).accepted).toEqual([
      history.clientPointId,
      live.clientPointId,
      update.clientPointId,
      laterLive.clientPointId,
    ]);
    expect(await storedPoints()).toHaveLength(2);
    const latest = await caller(memberId, memberDeviceId).groupTracking.getLatest({ groupId });
    expect(latest.points.map(({ nonce }) => nonce)).toEqual([laterLive.nonce]);

    await prisma.$executeRaw`
      DELETE FROM "TrackingPoint" WHERE "pointId" = ${arrival!.pointId}
    `;
    const afterRetention = stay(3);
    expect((await upload([afterRetention])).accepted).toEqual([afterRetention.clientPointId]);
    expect((await storedPoints()).map(({ pointId }) => pointId)).toContain(arrival!.pointId);
    await clearPoints();
  });

  test("history points over the device's daily allowance are discarded, not stored", async () => {
    const allowance = {
      namespace: "groupTracking.historyAllowance",
      identifier: { type: "deviceGroup" as const, deviceId: ownerDeviceId, groupId },
      limit: 2_880,
      windowMs: 86_400_000,
    };
    await cache.rateLimits.reset(allowance);
    await cache.rateLimits.take({ ...allowance, cost: 2_879 });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const kept = point("allowance-kept");
    const over = point("allowance-over");
    const live = point("allowance-live", { role: "LIVE" });

    expect(await upload([kept, live, over])).toMatchObject({
      accepted: [kept.clientPointId, live.clientPointId],
      discarded: [over.clientPointId],
      duplicates: [],
    });
    const latest = await caller(memberId, memberDeviceId).groupTracking.getLatest({ groupId });
    expect(latest.points.map(({ nonce }) => nonce)).toEqual([over.nonce]);
    expect(await upload([kept])).toMatchObject({ duplicates: [kept.clientPointId] });
    expect((await storedPoints()).map(({ pointId }) => pointId)).toEqual([
      Buffer.from(kept.clientPointId, "base64").readBigInt64BE(),
    ]);
    warn.mockRestore();
    await cache.rateLimits.reset(allowance);
    await clearPoints();
  });

  test("a point another upload stores first gives its allowance back", async () => {
    const allowance = {
      namespace: "groupTracking.historyAllowance",
      identifier: { type: "deviceGroup" as const, deviceId: ownerDeviceId, groupId },
      limit: 2_880,
      windowMs: 86_400_000,
    };
    await cache.rateLimits.reset(allowance);
    await upload([point("race-stream")]);
    const { id: streamId } = await prisma.trackingStream.findFirstOrThrow({
      where: { groupId, senderDeviceId: ownerDeviceId },
      select: { id: true },
    });
    const raced = point("race-point");
    const inserted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const otherUpload = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "TrackingPoint" ("streamId", "pointId", "receivedHour", "capturedHour", "payload")
        VALUES (${streamId}, ${pointIdOf(raced.clientPointId)}::bigint, 0, 0, '\\x00'::bytea)
      `;
      inserted.resolve();
      await release.promise;
    });
    await inserted.promise;
    const racing = upload([raced]);
    let waiting = 0;
    for (let attempt = 0; attempt < 200 && waiting === 0; attempt += 1) {
      await Bun.sleep(10);
      const [row] = await prisma.$queryRaw<Array<{ waiting: number }>>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%INSERT INTO "TrackingPoint"%'
      `;
      waiting = row?.waiting ?? 0;
    }
    release.resolve();
    await otherUpload;

    expect(waiting).toBe(1);
    expect(await racing).toMatchObject({ accepted: [], duplicates: [raced.clientPointId] });
    expect((await cache.rateLimits.peek(allowance)).remaining).toBe(2_879);
    await cache.rateLimits.reset(allowance);
    await clearPoints();
  });

  test("points from an old sharing revision or a paused phone are discarded", async () => {
    await prisma.userDevice.update({
      where: { id: ownerDeviceId },
      data: { sharingRevision: 2 },
    });
    const current = point("revision-current", {
      clientPointId: testClientPointId(`${prefix}-revision-current`, "s0.2:"),
    });
    const old = point("revision-old");
    expect(await upload([current, old])).toMatchObject({
      accepted: [current.clientPointId],
      discarded: [old.clientPointId],
    });
    await prisma.userDevice.update({
      where: { id: ownerDeviceId },
      data: { sharingPaused: true },
    });
    const paused = point("revision-paused", {
      clientPointId: testClientPointId(`${prefix}-revision-paused`, "s0.2:"),
      role: "LIVE",
    });
    expect(await upload([paused])).toMatchObject({
      accepted: [],
      discarded: [paused.clientPointId],
    });
    expect(
      (
        await caller(memberId, memberDeviceId).groupTracking.getLatest({
          groupId,
        })
      ).points,
    ).toEqual([]);
    await prisma.userDevice.update({
      where: { id: ownerDeviceId },
      data: { sharingPaused: false },
    });
    expect(
      (
        await caller(memberId, memberDeviceId).groupTracking.getLatest({
          groupId,
        })
      ).points.map(({ nonce }) => nonce),
    ).toEqual([current.nonce]);
    await prisma.userDevice.update({
      where: { id: ownerDeviceId },
      data: { sharingRevision: 0 },
    });
    await clearPoints();
  });

  test("upload responses carry a key state that changes when tracking keys need checking", async () => {
    const keyState = async (seed: string) => (await upload([point(seed)])).keyState;
    const first = await keyState("state-1");
    expect(await keyState("state-2")).toBe(first);
    await prisma.userDevice.update({
      where: { id: ownerDeviceId },
      data: { sharingRevision: { increment: 1 } },
    });
    const afterSharing = await keyState("state-3");
    expect(afterSharing).not.toBe(first);
    await prisma.group.update({
      where: { id: groupId },
      data: { epochRotationRequired: true },
    });
    const afterRotation = await keyState("state-4");
    expect(afterRotation).not.toBe(afterSharing);
    await prisma.group.update({
      where: { id: groupId },
      data: { epochRotationRequired: false },
    });
    await prisma.userDevice.update({
      where: { id: ownerDeviceId },
      data: { sharingRevision: { decrement: 1 } },
    });
    expect(await keyState("state-5")).toBe(first);
    const joined = await prisma.groupMember.create({
      data: {
        groupId,
        userId: outsiderId,
        role: "MEMBER",
        joinedEpochNumber: 1,
      },
    });
    const afterJoin = await keyState("state-6");
    expect(afterJoin).not.toBe(first);
    await prisma.groupMember.delete({ where: { id: joined.id } });
    expect(await keyState("state-7")).toBe(first);
    const newEpochId = `${prefix}-state-epoch`;
    await prisma.groupEpoch.create({
      data: {
        id: newEpochId,
        groupId,
        epochNumber: 2,
        createdByDeviceId: ownerDeviceId,
        senderPublicKey: deviceKey.publicKey,
      },
    });
    const afterEpoch = await keyState("state-8");
    expect(afterEpoch).not.toBe(first);
    expect(afterEpoch).not.toBe(afterJoin);
    await prisma.groupEpoch.delete({ where: { id: newEpochId } });
    expect(await keyState("state-9")).toBe(first);
    await clearPoints();
  }, 30_000);

  test("reports points for a deleted epoch as expired but rejects another group's epoch", async () => {
    const expired = point("expired", { epochId: `${prefix}-deleted-epoch` });
    const current = point("current");
    expect(await upload([expired, current])).toEqual({
      accepted: [current.clientPointId],
      discarded: [],
      duplicates: [],
      expired: [expired.clientPointId],
      keyState: expect.any(String),
    });
    const otherGroupId = `${prefix}-other-group`;
    await prisma.group.create({
      data: {
        id: otherGroupId,
        name: "Other",
        groupEpochs: {
          create: {
            id: `${prefix}-other-epoch`,
            epochNumber: 1,
            createdByDeviceId: ownerDeviceId,
            senderPublicKey: deviceKey.publicKey,
          },
        },
      },
    });
    await expect(
      upload([point("foreign", { epochId: `${prefix}-other-epoch` })]),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Epoch does not belong to this group.",
    });
    await prisma.group.delete({ where: { id: otherGroupId } });
    expect(await storedPoints()).toHaveLength(1);
    await clearPoints();
  });

  test("uploadBatch rejections carry a reason for not a member, a deleted group and an unknown device", async () => {
    await expect(
      caller(outsiderId, outsiderDeviceId).groupTracking.uploadBatch({
        groupId,
        points: [point("reason-outsider", { senderDeviceId: outsiderDeviceId })],
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: { reason: "NOT_GROUP_MEMBER" },
    });
    await expect(
      caller(ownerId, ownerDeviceId).groupTracking.uploadBatch({
        groupId: `${prefix}-deleted-group`,
        points: [point("reason-gone")],
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: { reason: "GROUP_GONE" },
    });
    await expect(
      upload([
        point("reason-device", {
          senderDeviceId: `${prefix}-unknown-device`,
        }),
      ]),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: { reason: "DEVICE_NOT_REGISTERED" },
    });
  });

  test("getLatest returns each active device's newest point and skips devices with none", async () => {
    const ownerTabletId = `${prefix}-owner-tablet`;
    const ownerRemovedId = `${prefix}-owner-removed`;
    const ownerSilentId = `${prefix}-owner-silent`;
    const ownerPendingId = `${prefix}-owner-pending`;
    await prisma.userDevice.createMany({
      data: [
        {
          id: ownerTabletId,
          userId: ownerId,
          name: "Tablet",
          icon: "tablet" as const,
          platform: "android",
        },
        {
          id: ownerRemovedId,
          userId: ownerId,
          name: "Old phone",
          icon: "phone" as const,
          revokedAt: new Date(),
        },
        {
          id: ownerSilentId,
          userId: ownerId,
          name: "Watch",
          icon: "star" as const,
        },
      ].map((device) => ({
        ...device,
        activatedAt: new Date(),
        publicKey: createDeviceKeyPair().publicKey,
        publicKeyAlgorithm: "X25519",
      })),
    });
    await prisma.userDevice.create({
      data: {
        id: ownerPendingId,
        userId: ownerId,
        name: "New phone",
        icon: "phone",
        publicKey: createDeviceKeyPair().publicKey,
        publicKeyAlgorithm: "X25519",
      },
    });
    const storeLatest = (
      senderUserId: string,
      senderDeviceId: string,
      at: string,
      marker: number,
    ) =>
      storeLatestTrackingPoint(prisma, {
        epochId,
        groupId,
        payload: new Uint8Array(63).fill(marker),
        senderDeviceId,
        senderUserId,
        updatedAt: new Date(at),
      });
    const markerOf = (point: { nonce: string }) => Buffer.from(point.nonce, "base64")[0];
    const latest = async () =>
      (
        await caller(memberId, memberDeviceId).groupTracking.getLatest({
          groupId,
        })
      ).points
        .map((point) => [point.senderUserId, point.senderDeviceId, markerOf(point)])
        .sort((first, second) => first.join().localeCompare(second.join()));

    await storeLatest(ownerId, ownerDeviceId, "2030-01-01T10:00:00.000Z", 1);
    await storeLatest(ownerId, ownerDeviceId, "2030-01-01T12:00:00.000Z", 2);
    expect(await latest()).toEqual([[ownerId, ownerDeviceId, 2]]);

    await storeLatest(ownerId, ownerTabletId, "2030-01-01T08:00:00.000Z", 3);
    await storeLatest(ownerId, ownerRemovedId, "2030-01-01T13:00:00.000Z", 4);
    await storeLatest(ownerId, ownerPendingId, "2030-01-01T14:00:00.000Z", 5);
    await storeLatest(memberId, memberDeviceId, "2030-01-01T11:00:00.000Z", 6);
    expect(await latest()).toEqual(
      [
        [memberId, memberDeviceId, 6],
        [ownerId, ownerDeviceId, 2],
        [ownerId, ownerTabletId, 3],
      ].sort((first, second) => first.join().localeCompare(second.join())),
    );

    const poll = (cursor: { senderDeviceId: string; updatedAt: Date } | null, limit?: number) =>
      caller(memberId, memberDeviceId).groupTracking.poll({
        groupId,
        cursor,
        ...(limit ? { limit } : {}),
      });
    const page = await poll(
      {
        senderDeviceId: ownerDeviceId,
        updatedAt: new Date("2030-01-01T07:00:00.000Z"),
      },
      2,
    );
    expect(page.points.map(markerOf)).toEqual([3, 6]);
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toEqual({
      senderDeviceId: memberDeviceId,
      updatedAt: new Date("2030-01-01T11:00:00.000Z"),
    });
    const rest = await poll(page.cursor);
    expect(rest.points.map(markerOf)).toEqual([2]);
    expect(rest.hasMore).toBe(false);
    expect(rest.cursor).toEqual({
      senderDeviceId: ownerPendingId,
      updatedAt: new Date("2030-01-01T14:00:00.000Z"),
    });
    expect((await poll(rest.cursor)).points).toEqual([]);

    await prisma.groupMember.update({
      where: { userId_groupId: { groupId, userId: memberId } },
      data: { joinedEpochNumber: 2 },
    });
    expect(await latest()).toEqual([]);
    await prisma.groupMember.update({
      where: { userId_groupId: { groupId, userId: memberId } },
      data: { joinedEpochNumber: 1 },
    });

    const pending = caller(ownerId, ownerPendingId).groupTracking;
    const devicePending = {
      code: "FORBIDDEN",
      cause: expect.any(DevicePendingError),
    };
    await expect(pending.getLatest({ groupId })).rejects.toMatchObject(devicePending);
    await expect(pending.poll({ groupId })).rejects.toMatchObject(devicePending);
    await expect(
      pending.uploadBatch({
        groupId,
        points: [
          {
            ...point("pending-upload", { senderDeviceId: ownerPendingId }),
          },
        ],
      }),
    ).rejects.toMatchObject(devicePending);

    const devices = await caller(memberId, memberDeviceId).groupMembership.listMemberDevices({
      groupId,
    });
    expect(
      devices
        .filter((device) => device.deviceId.startsWith(prefix))
        .map((device) => device.deviceId)
        .sort(),
    ).toEqual([ownerDeviceId, ownerTabletId, ownerSilentId, memberDeviceId].sort());
    expect(devices.find((device) => device.deviceId === ownerTabletId)).toEqual({
      deviceId: ownerTabletId,
      userId: ownerId,
      name: "Tablet",
      icon: "tablet",
      platform: "android",
    });
    expect(devices.find((device) => device.deviceId === ownerSilentId)?.platform).toBeNull();
    await expect(
      caller(outsiderId, outsiderDeviceId).groupMembership.listMemberDevices({
        groupId,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "You are not a member of this group",
    });
  });
});
