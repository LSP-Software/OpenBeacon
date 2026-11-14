import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { prisma } from "@openbeacon/database";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import { createEpochCleanup, createLocationHistoryCleanup } from "./locationHistoryCleanup.ts";

const prefix = `location-history-cleanup-${crypto.randomUUID()}`;
const userId = `${prefix}-user`;
const deviceId = `${prefix}-device`;
const historyKeyId = `${prefix}-history-key`;
const day = 24 * 60 * 60_000;
let databaseNow = new Date();

const ago = (days: number) => new Date(databaseNow.getTime() - days * day);

const createGroup = async (name: string, epochDaysAgo: number[]) => {
  const groupId = `${prefix}-${name}`;
  await prisma.group.create({ data: { id: groupId, name } });
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

const addPayloads = (
  groupId: string,
  payloads: Array<{ epoch: number; createdAt: Date; kind?: string; name?: string }>,
) =>
  prisma.groupEncryptedPayload.createMany({
    data: payloads.map(({ epoch, createdAt, kind = TRACKING_POINT_KIND, name }, index) => ({
      id: `${groupId}-${name ?? `point-${index}`}`,
      groupId,
      epochId: `${groupId}-epoch-${epoch}`,
      senderDeviceId: deviceId,
      senderUserId: userId,
      kind,
      algorithm: "XChaCha20-Poly1305",
      nonce: "nonce",
      ciphertext: "ciphertext",
      clientPointId: `${name ?? "point"}-${index}`,
      createdAt,
    })),
  });

const payloadNames = async (groupId: string) =>
  (
    await prisma.groupEncryptedPayload.findMany({
      where: { groupId },
      select: { id: true },
      orderBy: { id: "asc" },
    })
  ).map(({ id }) => id.slice(groupId.length + 1));

const epochNumbers = async (groupId: string) =>
  (
    await prisma.groupEpoch.findMany({
      where: { groupId },
      select: { epochNumber: true },
      orderBy: { epochNumber: "asc" },
    })
  ).map(({ epochNumber }) => epochNumber);

const payloadCount = (groupId: string) =>
  prisma.groupEncryptedPayload.count({ where: { groupId } });

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("Location history clean-up", () => {
  beforeAll(async () => {
    const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!clock) throw new Error("Unable to read database time.");
    databaseNow = clock.now;
    const leftover = "location-history-cleanup-";
    await prisma.groupEncryptedPayload.deleteMany({
      where: {
        OR: [
          { groupId: { startsWith: leftover } },
          { senderUserId: { startsWith: leftover } },
          { kind: TRACKING_POINT_KIND, createdAt: { lt: ago(14) } },
        ],
      },
    });
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
    await prisma.groupEncryptedPayload.deleteMany({ where: { senderUserId: userId } });
    await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test("deletes location history older than 14 days and keeps the rest", async () => {
    const groupId = await createGroup("boundary", [200]);
    const otherGroupId = await createGroup("other", [200]);
    await addPayloads(groupId, [
      { epoch: 1, createdAt: ago(90), name: "old" },
      { epoch: 1, createdAt: ago(14 + 1 / 24), name: "justOver" },
      { epoch: 1, createdAt: ago(14 - 1 / 24), name: "justUnder" },
      { epoch: 1, createdAt: ago(1), name: "recent" },
      { epoch: 1, createdAt: ago(90), kind: "other", name: "oldOtherKind" },
    ]);
    await addPayloads(otherGroupId, [{ epoch: 1, createdAt: ago(10), name: "recent" }]);
    await createLocationHistoryCleanup()();
    expect(await payloadNames(groupId)).toEqual(["justUnder", "oldOtherKind", "recent"]);
    expect(await payloadNames(otherGroupId)).toEqual(["recent"]);
  });

  test("deletes empty epochs superseded before the cutoff, with their wraps", async () => {
    const groupId = await createGroup("epochs", [50, 30, 20, 15, 12, 3]);
    await addPayloads(groupId, [
      { epoch: 1, createdAt: ago(40) },
      { epoch: 3, createdAt: ago(1), name: "lateUpload" },
      { epoch: 5, createdAt: ago(8) },
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

  test("deletes the oldest points first across groups, up to the run limit", async () => {
    const groupIds = [
      await createGroup("cap-a", [200]),
      await createGroup("cap-b", [200]),
      await createGroup("cap-c", [200]),
    ];
    for (const groupId of groupIds) {
      await addPayloads(
        groupId,
        Array.from({ length: 5 }, (_, index) => ({ epoch: 1, createdAt: ago(90 + index) })),
      );
    }
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const run = createLocationHistoryCleanup({ batchSize: 2, runLimit: 6 });
    const counts = () => Promise.all(groupIds.map(payloadCount));
    await run();
    expect(await counts()).toEqual([3, 3, 3]);
    await run();
    expect(await counts()).toEqual([1, 1, 1]);
    await run();
    expect(await counts()).toEqual([0, 0, 0]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  test("skips an epoch that an upload in progress is using and deletes it on a later run", async () => {
    const groupId = await createGroup("race", [200, 100]);
    const error = spyOn(console, "error").mockImplementation(() => {});
    let epochsDuringUpload: number[] = [];
    const rollback = new Error("roll back the upload");
    const upload = prisma.$transaction(async (tx) => {
      await tx.groupEncryptedPayload.create({
        data: {
          id: `${groupId}-late`,
          groupId,
          epochId: `${groupId}-epoch-1`,
          senderDeviceId: deviceId,
          senderUserId: userId,
          kind: TRACKING_POINT_KIND,
          algorithm: "XChaCha20-Poly1305",
          nonce: "nonce",
          ciphertext: "ciphertext",
          clientPointId: "late",
        },
      });
      await createEpochCleanup()();
      epochsDuringUpload = await epochNumbers(groupId);
      throw rollback;
    });
    await expect(upload).rejects.toBe(rollback);
    expect(epochsDuringUpload).toEqual([1, 2]);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    expect(await payloadNames(groupId)).toEqual([]);
    await createEpochCleanup()();
    expect(await epochNumbers(groupId)).toEqual([2]);
  });
});
