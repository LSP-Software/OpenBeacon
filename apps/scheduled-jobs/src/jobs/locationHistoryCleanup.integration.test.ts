import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { type Prisma, prisma } from "@openbeacon/database";
import {
  createEpochCleanup,
  createLocationHistoryCleanup,
  createGroupHistoryCleanup,
} from "./locationHistoryCleanup.ts";

const prefix = `location-history-cleanup-${crypto.randomUUID()}`;
const userId = `${prefix}-user`;
const deviceId = `${prefix}-device`;
const historyKeyId = `${prefix}-history-key`;
const day = 24 * 60 * 60_000;
let databaseNow = new Date();

const ago = (days: number) => new Date(databaseNow.getTime() - days * day);
const hourOf = (date: Date) => Math.floor(date.getTime() / 3_600_000);

const createGroup = async (name: string, epochDaysAgo: number[]) => {
  const groupId = `${prefix}-${name}`;
  await prisma.group.create({
    data: {
      id: groupId,
      name,
      groupMembers: { create: { userId, role: "OWNER", joinedEpochNumber: 1 } },
    },
  });
  for (const [index, daysAgo] of epochDaysAgo.entries()) {
    const id = `${groupId}-epoch-${index + 1}`;
    await prisma.groupEpoch.create({
      data: {
        id,
        groupId,
        epochNumber: index + 1,
        createdByDeviceId: deviceId,
        senderPublicKey: "public-key",
        createdAt: ago(daysAgo),
        recipientKeys: {
          create: {
            recipientDeviceId: deviceId,
            wrappedKey: "wrapped",
            ephemeralPublicKey: "ephemeral",
            algorithm: "X25519",
          },
        },
        historyWraps: {
          create: {
            historyKeyId,
            senderPublicKey: "public-key",
            wrappedKey: "wrapped",
            ephemeralPublicKey: "ephemeral",
            algorithm: "X25519",
          },
        },
      },
    });
  }
  return groupId;
};

const pointNames = new Map<string, string>();
let nextPointId = 0;

const streamFor = async (
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  groupId: string,
  epoch: number,
) => {
  const [stream] = await db.$queryRaw<Array<{ id: bigint }>>`
    INSERT INTO "TrackingStream" ("groupId", "epochId", "senderDeviceId", "senderUserId", "revisionPrefix", "createdAt")
    VALUES (${groupId}, ${`${groupId}-epoch-${epoch}`}, ${deviceId}, ${userId}, '',
      (${ago(400).toISOString()}::timestamptz AT TIME ZONE 'UTC'))
    ON CONFLICT ("groupId", "epochId", "senderDeviceId", "revisionPrefix")
      DO UPDATE SET "senderUserId" = EXCLUDED."senderUserId"
    RETURNING id
  `;
  if (!stream) throw new Error("Tracking stream was not stored.");
  return stream.id;
};

const addPayloads = async (
  groupId: string,
  payloads: Array<{ epoch: number; receivedAt: Date; capturedOffset?: number; name?: string }>,
) => {
  for (const [index, { capturedOffset = 0, epoch, receivedAt, name }] of payloads.entries()) {
    const streamId = await streamFor(prisma, groupId, epoch);
    nextPointId += 1;
    pointNames.set(String(nextPointId), name ?? `point-${index}`);
    const receivedHour = hourOf(receivedAt);
    await prisma.$executeRaw`
      INSERT INTO "TrackingPoint" ("streamId", "pointId", "receivedHour", "capturedHour", "payload")
      VALUES (${streamId}, ${nextPointId}, ${receivedHour}, ${receivedHour + capturedOffset}, '\\x00'::bytea)
    `;
  }
};

const addLatest = async (groupId: string, epoch: number, updatedAt: Date) => {
  const streamId = await streamFor(prisma, groupId, epoch);
  await prisma.$executeRaw`
    INSERT INTO "TrackingLatestPoint" ("groupId", "senderDeviceId", "streamId", "payload", "updatedAt")
    VALUES (${groupId}, ${deviceId}, ${streamId}, '\\x00'::bytea, (${updatedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'))
  `;
};

const payloadNames = async (groupId: string) =>
  (
    await prisma.$queryRaw<Array<{ pointId: string }>>`
      SELECT "point"."pointId"::text AS "pointId"
      FROM "TrackingPoint" AS "point"
      JOIN "TrackingStream" AS "stream" ON "stream"."id" = "point"."streamId"
      WHERE "stream"."groupId" = ${groupId}
    `
  )
    .map(({ pointId }) => pointNames.get(pointId) ?? pointId)
    .sort();

const streamEpochs = async (groupId: string) =>
  (
    await prisma.trackingStream.findMany({
      where: { groupId },
      select: { epoch: { select: { epochNumber: true } } },
    })
  )
    .map(({ epoch }) => epoch.epochNumber)
    .sort();

const epochNumbers = async (groupId: string) =>
  (
    await prisma.groupEpoch.findMany({
      where: { groupId },
      select: { epochNumber: true },
      orderBy: { epochNumber: "asc" },
    })
  ).map(({ epochNumber }) => epochNumber);

const addDrive = async (groupId: string, epoch: number, startedAt: Date, driveId: string) => {
  await prisma.$executeRaw`
    INSERT INTO "DriveCopy" ("groupId", "driveId", "epochId", "senderDeviceId", "senderUserId", "startHour", "payload", "receivedAt")
    VALUES (${groupId}, ${driveId}, ${`${groupId}-epoch-${epoch}`}, ${deviceId}, ${userId},
      ${hourOf(startedAt)}, '\\x00'::bytea, (${startedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'))
  `;
};

const addCrashAlert = async (
  groupId: string,
  epoch: number,
  receivedAt: Date,
  messageId: string,
) => {
  await prisma.$executeRaw`
    INSERT INTO "CrashAlert" ("id", "groupId", "messageId", "epochId", "senderDeviceId", "senderUserId", "payload", "receivedAt")
    VALUES (${`${groupId}-${messageId}`}, ${groupId}, ${messageId}, ${`${groupId}-epoch-${epoch}`}, ${deviceId}, ${userId},
      '\\x00'::bytea, (${receivedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'))
  `;
};

const driveIds = async (groupId: string) =>
  (await prisma.driveCopy.findMany({ where: { groupId }, select: { driveId: true } }))
    .map(({ driveId }) => driveId)
    .sort();

const payloadCount = async (groupId: string) => (await payloadNames(groupId)).length;

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("Location history clean-up", () => {
  beforeAll(async () => {
    const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!clock) throw new Error("Unable to read database time.");
    databaseNow = clock.now;
    const leftover = "location-history-cleanup-";
    await prisma.trackingStream.deleteMany({
      where: {
        OR: [{ groupId: { startsWith: leftover } }, { senderUserId: { startsWith: leftover } }],
      },
    });
    await prisma.$executeRaw`
      DELETE FROM "TrackingPoint" WHERE "receivedHour" < ${hourOf(ago(14))}
    `;
    await prisma.group.deleteMany({ where: { id: { startsWith: leftover } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: leftover } } });
    await prisma.user.create({
      data: {
        id: userId,
        name: userId,
        email: `${userId}@example.test`,
        devices: {
          create: {
            id: deviceId,
            name: "Phone",
            icon: "phone",
            publicKey: "public-key",
            publicKeyAlgorithm: "X25519",
            activatedAt: ago(200),
          },
        },
        historyKeys: {
          create: { id: historyKeyId, version: 1, publicKey: "public-key", algorithm: "X25519" },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.trackingStream.deleteMany({ where: { senderUserId: userId } });
    await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test("deletes location history older than 14 days and keeps the rest", async () => {
    const groupId = await createGroup("boundary", [200]);
    const otherGroupId = await createGroup("other", [200]);
    await addPayloads(groupId, [
      { epoch: 1, receivedAt: ago(90), name: "old" },
      { epoch: 1, receivedAt: ago(14 + 1 / 24), name: "justOver" },
      { epoch: 1, receivedAt: ago(14 - 1 / 24), name: "justUnder" },
      { epoch: 1, receivedAt: ago(1), name: "recent" },
    ]);
    await addPayloads(otherGroupId, [{ epoch: 1, receivedAt: ago(10), name: "recent" }]);
    await createLocationHistoryCleanup()();
    expect(await payloadNames(groupId)).toEqual(["justUnder", "recent"]);
    expect(await payloadNames(otherGroupId)).toEqual(["recent"]);
  });

  test("deletes late points by when they arrived and never keeps one past 14 days and 1 hour", async () => {
    const groupId = await createGroup("late", [200]);
    const cutoffHour = hourOf(ago(14));
    const atHour = (hour: number) => new Date(hour * 3_600_000 + 1_000);
    await addPayloads(groupId, [
      { epoch: 1, receivedAt: atHour(cutoffHour - 2), capturedOffset: -336, name: "lateAndOld" },
      { epoch: 1, receivedAt: atHour(cutoffHour - 1), capturedOffset: 1, name: "aheadAndOld" },
      { epoch: 1, receivedAt: atHour(cutoffHour), capturedOffset: 1, name: "lastKeptHour" },
      { epoch: 1, receivedAt: ago(1), capturedOffset: -336, name: "lateButRecent" },
    ]);
    await createLocationHistoryCleanup()();
    expect(await payloadNames(groupId)).toEqual(["lastKeptHour", "lateButRecent"]);
    const [oldest] = await prisma.$queryRaw<Array<{ receivedHour: number }>>`
      SELECT min("point"."receivedHour") AS "receivedHour"
      FROM "TrackingPoint" AS "point"
      JOIN "TrackingStream" AS "stream" ON "stream"."id" = "point"."streamId"
      WHERE "stream"."groupId" = ${groupId}
    `;
    expect(databaseNow.getTime() - oldest!.receivedHour * 3_600_000).toBeLessThan(
      14 * day + 3_600_000,
    );
  });

  test("deletes latest points more than 14 days old and streams left with no point and no latest point", async () => {
    const staleGroupId = await createGroup("stale-latest", [200, 100, 50]);
    await addLatest(staleGroupId, 1, ago(15));
    await addPayloads(staleGroupId, [{ epoch: 2, receivedAt: ago(20) }]);
    await addPayloads(staleGroupId, [{ epoch: 3, receivedAt: ago(2), name: "kept" }]);
    const freshGroupId = await createGroup("fresh-latest", [200]);
    await addLatest(freshGroupId, 1, ago(13));
    await createLocationHistoryCleanup()();
    expect(await prisma.trackingLatestPoint.count({ where: { groupId: staleGroupId } })).toBe(0);
    expect(await streamEpochs(staleGroupId)).toEqual([3]);
    expect(await payloadNames(staleGroupId)).toEqual(["kept"]);
    expect(await prisma.trackingLatestPoint.count({ where: { groupId: freshGroupId } })).toBe(1);
    expect(await streamEpochs(freshGroupId)).toEqual([1]);
  });

  test("keeps an empty stream that an upload in progress is filling, with its new point", async () => {
    const groupId = await createGroup("filling", [200]);
    const streamId = await streamFor(prisma, groupId, 1);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "TrackingStream" WHERE id = ${streamId} FOR SHARE`;
      await createLocationHistoryCleanup()();
      await tx.$executeRaw`
        INSERT INTO "TrackingPoint" ("streamId", "pointId", "receivedHour", "capturedHour", "payload")
        VALUES (${streamId}, 1, ${hourOf(databaseNow)}, ${hourOf(databaseNow)}, '\\x00'::bytea)
      `;
    });
    expect(await streamEpochs(groupId)).toEqual([1]);
    expect(await payloadCount(groupId)).toBe(1);
  });

  test("deletes empty epochs superseded before the cutoff, with their wraps", async () => {
    const groupId = await createGroup("epochs", [50, 30, 20, 15, 12, 3]);
    await addPayloads(groupId, [
      { epoch: 1, receivedAt: ago(40) },
      { epoch: 3, receivedAt: ago(1), name: "lateUpload" },
      { epoch: 5, receivedAt: ago(8) },
    ]);
    const lonelyGroupId = await createGroup("lonely", [300]);
    const staleGroupId = await createGroup("stale", [300, 200]);
    await createLocationHistoryCleanup()();
    await createEpochCleanup({ pageSize: 2 })();
    expect(await epochNumbers(groupId)).toEqual([3, 4, 5, 6]);
    expect(await epochNumbers(lonelyGroupId)).toEqual([1]);
    expect(await epochNumbers(staleGroupId)).toEqual([2]);
    const deletedEpochIds = [1, 2].map((epoch) => `${groupId}-epoch-${epoch}`);
    expect(
      await prisma.groupEpochRecipientKey.count({
        where: { groupEpochId: { in: deletedEpochIds } },
      }),
    ).toBe(0);
    expect(
      await prisma.groupEpochHistoryWrap.count({
        where: { groupEpochId: { in: deletedEpochIds } },
      }),
    ).toBe(0);
    expect(await prisma.groupEpochRecipientKey.count({ where: { groupEpoch: { groupId } } })).toBe(
      4,
    );
  });

  test("deletes old points across groups in batches, up to the run limit", async () => {
    const groupIds = [
      await createGroup("cap-a", [200]),
      await createGroup("cap-b", [200]),
      await createGroup("cap-c", [200]),
    ];
    for (const groupId of groupIds) {
      await addPayloads(
        groupId,
        Array.from({ length: 5 }, (_, index) => ({ epoch: 1, receivedAt: ago(90 + index) })),
      );
    }
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const run = createLocationHistoryCleanup({ batchSize: 2, runLimit: 6 });
    const remaining = async () =>
      (await Promise.all(groupIds.map(payloadCount))).reduce((sum, count) => sum + count, 0);
    await run();
    expect(await remaining()).toBe(9);
    await run();
    expect(await remaining()).toBe(3);
    await run();
    expect(await remaining()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  test("keeps an epoch that a place still uses and deletes it once the place moves on", async () => {
    const groupId = await createGroup("places", [200, 100]);
    const place = await prisma.place.create({
      data: {
        groupId,
        name: "Home",
        emoji: "🏠",
        epochId: `${groupId}-epoch-1`,
        senderDeviceId: deviceId,
        algorithm: "XChaCha20-Poly1305",
        nonce: "nonce",
        ciphertext: "ciphertext",
        createdByUserId: userId,
      },
    });
    await createEpochCleanup()();
    expect(await epochNumbers(groupId)).toEqual([1, 2]);
    await prisma.place.update({
      where: { id: place.id },
      data: { epochId: `${groupId}-epoch-2` },
    });
    await createEpochCleanup()();
    expect(await epochNumbers(groupId)).toEqual([2]);
  });

  test("keeps an epoch that a group or profile picture key is still wrapped under", async () => {
    const groupPicture = await createGroup("group-picture", [200, 100]);
    await prisma.group.update({
      where: { id: groupPicture },
      data: { imageKeyEpochId: `${groupPicture}-epoch-1` },
    });
    const profilePicture = await createGroup("profile-picture", [200, 100]);
    await prisma.groupMember.update({
      where: { userId_groupId: { userId, groupId: profilePicture } },
      data: { imageKeyEpochId: `${profilePicture}-epoch-1` },
    });

    await createEpochCleanup()();
    expect(await epochNumbers(groupPicture)).toEqual([1, 2]);
    expect(await epochNumbers(profilePicture)).toEqual([1, 2]);

    await prisma.group.update({
      where: { id: groupPicture },
      data: { imageKeyEpochId: `${groupPicture}-epoch-2` },
    });
    await prisma.groupMember.update({
      where: { userId_groupId: { userId, groupId: profilePicture } },
      data: { imageKeyEpochId: `${profilePicture}-epoch-2` },
    });
    await createEpochCleanup()();
    expect(await epochNumbers(groupPicture)).toEqual([2]);
    expect(await epochNumbers(profilePicture)).toEqual([2]);
  });

  test("deletes place transitions and group events more than 14 days old, in batches up to the run limit", async () => {
    const groupId = await createGroup("transitions", [200]);
    const place = await prisma.place.create({
      data: {
        groupId,
        name: "Home",
        emoji: "🏠",
        epochId: `${groupId}-epoch-1`,
        senderDeviceId: deviceId,
        algorithm: "XChaCha20-Poly1305",
        nonce: "nonce",
        ciphertext: "ciphertext",
        createdByUserId: userId,
      },
    });
    const transitions = [
      { name: "old", occurredAt: ago(30) },
      { name: "older", occurredAt: ago(60) },
      { name: "justOver", occurredAt: ago(14 + 1 / 24) },
      { name: "justUnder", occurredAt: ago(14 - 1 / 24) },
      { name: "recent", occurredAt: ago(1) },
    ];
    await prisma.placeTransition.createMany({
      data: transitions.map(({ name, occurredAt }) => ({
        id: `${groupId}-${name}`,
        placeId: place.id,
        groupId,
        deviceId,
        userId,
        direction: "ARRIVE" as const,
        occurredAt,
        clientId: crypto.randomUUID(),
        createdAt: ago(0),
      })),
    });
    await prisma.groupEvent.createMany({
      data: transitions.map(({ name, occurredAt }) => ({
        id: `${groupId}-${name}`,
        groupId,
        type: "MEMBER_JOINED" as const,
        subjectUserId: userId,
        createdAt: occurredAt,
      })),
    });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const run = createGroupHistoryCleanup({ batchSize: 2, runLimit: 2 });
    await run();
    expect(await prisma.placeTransition.count({ where: { groupId } })).toBe(3);
    expect(await prisma.groupEvent.count({ where: { groupId } })).toBe(3);
    expect(warn).toHaveBeenCalledTimes(2);
    await run();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    const remaining = await prisma.placeTransition.findMany({
      where: { groupId },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    expect(remaining.map(({ id }) => id.slice(groupId.length + 1))).toEqual([
      "justUnder",
      "recent",
    ]);
    const remainingEvents = await prisma.groupEvent.findMany({
      where: { groupId },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    expect(remainingEvents.map(({ id }) => id.slice(groupId.length + 1))).toEqual([
      "justUnder",
      "recent",
    ]);
  });

  test("skips an epoch that an upload in progress is using and deletes it on a later run", async () => {
    const groupId = await createGroup("race", [200, 100]);
    const error = spyOn(console, "error").mockImplementation(() => {});
    let epochsDuringUpload: number[] = [];
    const rollback = new Error("roll back the upload");
    const upload = prisma.$transaction(async (tx) => {
      await streamFor(tx, groupId, 1);
      await createEpochCleanup()();
      epochsDuringUpload = await epochNumbers(groupId);
      throw rollback;
    });
    await expect(upload).rejects.toBe(rollback);
    expect(epochsDuringUpload).toEqual([1, 2]);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    expect(await streamEpochs(groupId)).toEqual([]);
    await createEpochCleanup()();
    expect(await epochNumbers(groupId)).toEqual([2]);
  });
  test("deletes points past each sender's chosen window, through group overrides, and keeps the latest point", async () => {
    const followsAccount = await createGroup("share-account", [200]);
    const overridden = await createGroup("share-override", [200]);
    const maximum = await createGroup("share-maximum", [200]);
    await prisma.user.update({ where: { id: userId }, data: { historyShare: "DAY_1" } });
    await prisma.groupMember.update({
      where: { userId_groupId: { userId, groupId: overridden } },
      data: { historyShare: "HOURS_6" },
    });
    await prisma.groupMember.update({
      where: { userId_groupId: { userId, groupId: maximum } },
      data: { historyShare: "MAXIMUM" },
    });
    for (const groupId of [followsAccount, overridden, maximum]) {
      await addPayloads(
        groupId,
        [3, 5, 6, 23, 24, 30].map((hours) => ({
          epoch: 1,
          receivedAt: ago(hours / 24),
          name: `${hours}h`,
        })),
      );
    }
    await addLatest(overridden, 1, ago(1 / 24));

    await createLocationHistoryCleanup({ batchSize: 2 })();

    expect(await payloadNames(followsAccount)).toEqual(["23h", "3h", "5h", "6h"]);
    expect(await payloadNames(overridden)).toEqual(["3h", "5h"]);
    expect(await payloadNames(maximum)).toEqual(["23h", "24h", "30h", "3h", "5h", "6h"]);
    expect(await prisma.trackingLatestPoint.count({ where: { groupId: overridden } })).toBe(1);
    await prisma.user.update({ where: { id: userId }, data: { historyShare: "MAXIMUM" } });
  });

  test("deletes the history and latest points a departed member left behind and keeps a current member's", async () => {
    const departedGroupId = await createGroup("departed", [200]);
    const memberGroupId = await createGroup("still-member", [200]);
    for (const groupId of [departedGroupId, memberGroupId]) {
      await addPayloads(groupId, [{ epoch: 1, receivedAt: ago(1), name: "recent" }]);
      await addLatest(groupId, 1, ago(1 / 24));
    }
    await prisma.groupMember.delete({
      where: { userId_groupId: { userId, groupId: departedGroupId } },
    });

    await createLocationHistoryCleanup()();

    expect(await payloadCount(departedGroupId)).toBe(0);
    expect(await prisma.trackingLatestPoint.count({ where: { groupId: departedGroupId } })).toBe(0);
    expect(await streamEpochs(departedGroupId)).toEqual([]);
    expect(await payloadNames(memberGroupId)).toEqual(["recent"]);
    expect(await prisma.trackingLatestPoint.count({ where: { groupId: memberGroupId } })).toBe(1);
    expect(await streamEpochs(memberGroupId)).toEqual([1]);
  });

  test("deletes Drives that started past the maximum, past each sender's window, or after they left", async () => {
    const maximum = await createGroup("drives-maximum", [200]);
    const shortened = await createGroup("drives-shortened", [200]);
    const departed = await createGroup("drives-departed", [200]);
    await prisma.groupMember.update({
      where: { userId_groupId: { userId, groupId: shortened } },
      data: { historyShare: "HOURS_6" },
    });
    for (const groupId of [maximum, shortened, departed]) {
      await addDrive(groupId, 1, ago(15), "old");
      await addDrive(groupId, 1, ago(13), "13d");
      await addDrive(groupId, 1, ago(2 / 24), "2h");
    }
    await prisma.groupMember.delete({ where: { userId_groupId: { userId, groupId: departed } } });

    await createLocationHistoryCleanup()();

    expect(await driveIds(maximum)).toEqual(["13d", "2h"]);
    expect(await driveIds(shortened)).toEqual(["2h"]);
    expect(await driveIds(departed)).toEqual([]);
  });

  test("deletes Crash alerts past each sender's window, an hour after last location only, or after they left", async () => {
    const maximum = await createGroup("crashes-maximum", [200]);
    const shortened = await createGroup("crashes-shortened", [200]);
    const lastLocation = await createGroup("crashes-last-location", [200]);
    const departed = await createGroup("crashes-departed", [200]);
    await prisma.groupMember.update({
      where: { userId_groupId: { userId, groupId: shortened } },
      data: { historyShare: "HOURS_6" },
    });
    await prisma.groupMember.update({
      where: { userId_groupId: { userId, groupId: lastLocation } },
      data: { historyShare: "LAST_LOCATION" },
    });
    for (const groupId of [maximum, shortened, lastLocation, departed]) {
      await addCrashAlert(groupId, 1, ago(3), "3d");
      await addCrashAlert(groupId, 1, ago(2 / 24), "2h");
      await addCrashAlert(groupId, 1, ago(0.5 / 24), "30m");
    }
    await prisma.groupMember.delete({ where: { userId_groupId: { userId, groupId: departed } } });

    await createLocationHistoryCleanup()();

    const messageIds = async (groupId: string) =>
      (await prisma.crashAlert.findMany({ where: { groupId } }))
        .map(({ messageId }) => messageId)
        .sort();
    expect(await messageIds(maximum)).toEqual(["2h", "30m", "3d"]);
    expect(await messageIds(shortened)).toEqual(["2h", "30m"]);
    expect(await messageIds(lastLocation)).toEqual(["30m"]);
    expect(await messageIds(departed)).toEqual([]);
  });

  test("keeps an epoch that a stored Drive uses and deletes it once the Drive is gone", async () => {
    const groupId = await createGroup("drive-epoch", [200, 100]);
    await addDrive(groupId, 1, ago(1), "drive");
    await createEpochCleanup()();
    expect(await epochNumbers(groupId)).toEqual([1, 2]);
    await prisma.driveCopy.deleteMany({ where: { groupId } });
    await createEpochCleanup()();
    expect(await epochNumbers(groupId)).toEqual([2]);
  });

  test("deletes Crash alerts past the history maximum and keeps their Epoch until then", async () => {
    const groupId = await createGroup("crash-alerts", [200, 100]);
    await addCrashAlert(groupId, 1, ago(15), "old");
    await addCrashAlert(groupId, 1, ago(1), "recent");
    await createGroupHistoryCleanup()();
    expect(
      (await prisma.crashAlert.findMany({ where: { groupId } })).map(({ messageId }) => messageId),
    ).toEqual(["recent"]);
    await createEpochCleanup()();
    expect(await epochNumbers(groupId)).toEqual([1, 2]);
    await prisma.crashAlert.deleteMany({ where: { groupId } });
    await createEpochCleanup()();
    expect(await epochNumbers(groupId)).toEqual([2]);
  });
});
