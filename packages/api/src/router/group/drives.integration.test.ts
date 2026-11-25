import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  type DriveRecord,
  generateGroupEpochKey,
  markPassengerDrive,
  openDriveRecord,
  sealDriveRecord,
} from "@openbeacon/encryption";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { drivesRouter } from "../drivesRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";
import { groupSettingsRouter } from "./groupSettingsRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";

const prefix = `drives-${crypto.randomUUID()}`;
const driverId = `${prefix}-driver`;
const viewerId = `${prefix}-viewer`;
const lateId = `${prefix}-late`;
const driverDeviceId = `${prefix}-driver-device`;
const tabletDeviceId = `${prefix}-tablet-device`;
const viewerDeviceId = `${prefix}-viewer-device`;
const lateDeviceId = `${prefix}-late-device`;
const users = [driverId, viewerId, lateId];
const groupIds = [`${prefix}-family`, `${prefix}-work`];
const [familyId = "", workId = ""] = groupIds;
const epochKeys = new Map(
  groupIds.flatMap((groupId) =>
    [1, 2].map((epoch) => [`${groupId}-epoch-${epoch}`, generateGroupEpochKey()]),
  ),
);
const cache = createIntegrationTestCache(() => 0);
const router = createTRPCRouter({
  drives: drivesRouter,
  groupMembership: groupMembershipRouter,
  groupSettings: groupSettingsRouter,
  groupTracking: groupTrackingRouter,
});
const caller = (userId: string, deviceId: string) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      deviceId,
      session: { user: { id: userId }, session: { id: `${userId}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );

const HOUR_MS = 3_600_000;
const nowHour = () => Math.floor(Date.now() / HOUR_MS);
const allowance = (groupId: string, deviceId = driverDeviceId) => ({
  namespace: "groupTracking.driveAllowance",
  identifier: { type: "deviceGroup" as const, deviceId, groupId },
  limit: 50,
  windowMs: 86_400_000,
});

const record = (startHour = nowHour() - 1): DriveRecord => ({
  driveId: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex"),
  start: { time: startHour * HOUR_MS + 600_000, latitude: 51.5074, longitude: -0.1278 },
  end: { time: startHour * HOUR_MS + 1_900_000, latitude: 51.5521, longitude: -0.0714 },
  distance: 14_210,
  checkedDistance: 14_210,
  duration: 1_300,
  topSpeed: 27.31,
  averageSpeed: 10.93,
  utcOffsetMinutes: 0,
  counts: { HARD_BRAKING: 1, RAPID_ACCELERATION: 0, SPEEDING: 0, PHONE_USE: 0 },
  passenger: false,
  speedLimitsChecked: true,
  tellGroup: true,
  events: [
    {
      type: "HARD_BRAKING",
      timeOffset: 400,
      duration: 2,
      latitude: 51.52,
      longitude: -0.11,
      peak: 4.1,
      limit: null,
    },
  ],
});

const copy = (
  drive: DriveRecord,
  { epoch = 2, groupId = familyId, senderDeviceId = driverDeviceId } = {},
) => {
  const epochId = `${groupId}-epoch-${epoch}`;
  const epochKey = epochKeys.get(epochId);
  if (!epochKey) throw new Error("Missing test epoch key.");
  const sealed = sealDriveRecord({ epochId, epochKey, groupId, record: drive, senderDeviceId });
  return { ...sealed, epochId, senderDeviceId };
};

const upload = (
  copies: ReturnType<typeof copy>[],
  { groupId = familyId, userId = driverId, deviceId = driverDeviceId } = {},
) => caller(userId, deviceId).groupTracking.uploadBatch({ groupId, points: [], drives: copies });

const listDrives = async (groupId = familyId, userId = viewerId, deviceId = viewerDeviceId) =>
  (
    await caller(userId, deviceId).groupTracking.drives({
      groupId,
      fromHour: nowHour() - 400,
      toHour: nowHour() + 2,
    })
  ).drives;

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("drives with PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: users.map((id) => ({ id, name: id, email: `${id}@example.test` })),
    });
    await prisma.userDevice.createMany({
      data: [
        { id: driverDeviceId, userId: driverId },
        { id: tabletDeviceId, userId: driverId },
        { id: viewerDeviceId, userId: viewerId },
        { id: lateDeviceId, userId: lateId },
      ].map((device) => ({
        ...device,
        publicKey: createDeviceKeyPair().publicKey,
        publicKeyAlgorithm: "X25519",
        name: "Phone",
        icon: "phone" as const,
        activatedAt: new Date(),
      })),
    });
    for (const groupId of groupIds) {
      await prisma.group.create({
        data: {
          id: groupId,
          name: groupId,
          groupMembers: {
            create: [
              { userId: driverId, role: "OWNER", joinedEpochNumber: 1 },
              { userId: viewerId, role: "MEMBER", joinedEpochNumber: 1 },
              { userId: lateId, role: "MEMBER", joinedEpochNumber: 2 },
            ],
          },
        },
      });
      await prisma.groupEpoch.createMany({
        data: [1, 2].map((epochNumber) => ({
          id: `${groupId}-epoch-${epochNumber}`,
          groupId,
          epochNumber,
          createdByDeviceId: driverDeviceId,
          senderPublicKey: createDeviceKeyPair().publicKey,
        })),
      });
    }
  });

  beforeEach(async () => {
    await prisma.driveCopy.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.user.updateMany({
      where: { id: { in: users } },
      data: { historyShare: "MAXIMUM" },
    });
    await prisma.groupMember.updateMany({
      where: { groupId: { in: groupIds } },
      data: { historyShare: null },
    });
    for (const groupId of groupIds) await cache.rateLimits.reset(allowance(groupId));
  });

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  test("a Drive rides in the point batch and members read it back by hour", async () => {
    const drive = record();
    const sent = copy(drive);

    expect((await upload([sent])).drives).toEqual({
      accepted: [drive.driveId],
      discarded: [],
      duplicates: [],
      expired: [],
    });
    expect((await upload([sent])).drives?.duplicates).toEqual([drive.driveId]);

    const [listed, ...rest] = await listDrives();
    expect(rest).toEqual([]);
    expect(listed).toMatchObject({
      driveId: drive.driveId,
      epochId: sent.epochId,
      senderDeviceId: driverDeviceId,
      senderUserId: driverId,
      startHour: sent.startHour,
      replacedAt: null,
    });
    if (!listed) throw new Error("Drive not listed.");
    expect(
      openDriveRecord({
        epochId: listed.epochId,
        epochKey: epochKeys.get(listed.epochId) ?? generateGroupEpochKey(),
        groupId: familyId,
        sealed: listed,
        senderDeviceId: listed.senderDeviceId,
      }),
    ).toEqual(drive);
  });

  test("a copy of any other size is rejected", async () => {
    const sent = copy(record());
    const short = Buffer.from(sent.ciphertext, "base64").subarray(0, 1_008).toString("base64");
    const long = Buffer.concat([Buffer.from(sent.ciphertext, "base64"), Buffer.alloc(3)]).toString(
      "base64",
    );
    for (const ciphertext of [short, long]) {
      await expect(upload([{ ...sent, ciphertext }])).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    expect(await listDrives()).toEqual([]);
  });

  test("each device gets about 50 Drives a day in each Group and the rest are discarded", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    await cache.rateLimits.take({ ...allowance(familyId), cost: 49 });
    const kept = copy(record());
    const over = copy(record());

    expect((await upload([kept, over])).drives).toMatchObject({
      accepted: [kept.driveId],
      discarded: [over.driveId],
    });
    expect(
      (await upload([copy(record(), { groupId: workId })], { groupId: workId })).drives,
    ).toMatchObject({ accepted: [expect.any(String)] });
    expect((await upload([kept])).drives?.duplicates).toEqual([kept.driveId]);
    expect((await listDrives()).map(({ driveId }) => driveId)).toEqual([kept.driveId]);
    warn.mockRestore();
  });

  test("a Drive from an Epoch that is gone or before the uploader joined is expired", async () => {
    const drive = record();
    const gone = { ...copy(drive), epochId: `${familyId}-epoch-deleted` };
    expect((await upload([gone])).drives?.expired).toEqual([drive.driveId]);
    const beforeJoining = copy(record(), { epoch: 1, senderDeviceId: lateDeviceId });
    expect(
      (await upload([beforeJoining], { userId: lateId, deviceId: lateDeviceId })).drives?.expired,
    ).toEqual([beforeJoining.driveId]);
    expect(await listDrives()).toEqual([]);
  });

  test("the driver's history setting withholds Drives that started outside it", async () => {
    await caller(driverId, driverDeviceId).groupSettings.setHistoryShare({
      groupId: familyId,
      historyShare: "HOURS_6",
    });
    const inside = copy(record(nowHour() - 2));
    const outside = copy(record(nowHour() - 8));
    expect((await upload([inside, outside])).drives).toMatchObject({
      accepted: [inside.driveId],
      discarded: [outside.driveId],
    });

    await caller(driverId, driverDeviceId).groupSettings.setHistoryShare({
      groupId: familyId,
      historyShare: "LAST_LOCATION",
    });
    expect((await upload([copy(record())])).drives?.discarded).toHaveLength(1);
    expect(await listDrives()).toEqual([]);
  });

  test("shortening the history setting deletes Drives that started before it", async () => {
    const recent = copy(record(nowHour() - 2));
    const older = copy(record(nowHour() - 30));
    await upload([recent, older]);
    expect(await listDrives()).toHaveLength(2);

    await caller(driverId, driverDeviceId).groupSettings.setHistoryShare({
      groupId: familyId,
      historyShare: "DAY_1",
    });
    expect(
      (await prisma.driveCopy.findMany({ where: { groupId: familyId } })).map(
        ({ driveId }) => driveId,
      ),
    ).toEqual([recent.driveId]);

    await caller(driverId, driverDeviceId).groupSettings.setHistoryShare({
      groupId: familyId,
      historyShare: "MAXIMUM",
    });
    expect((await listDrives()).map(({ driveId }) => driveId)).toEqual([recent.driveId]);
  });

  test("a stored Drive outside the driver's current window isn't listed", async () => {
    const older = copy(record(nowHour() - 30));
    await upload([older]);
    await prisma.user.update({ where: { id: driverId }, data: { historyShare: "HOURS_6" } });
    expect(await listDrives()).toEqual([]);
  });

  test("a member who joined at a later Epoch can't list Drives from before", async () => {
    const early = copy(record(), { epoch: 1 });
    const later = copy(record(), { epoch: 2 });
    await upload([early, later]);
    expect(
      (await listDrives(familyId, lateId, lateDeviceId)).map(({ driveId }) => driveId),
    ).toEqual([later.driveId]);
    expect(await listDrives()).toHaveLength(2);
  });

  test("deleting a Drive removes every Group copy at once, from any device on the account", async () => {
    const drive = record();
    const kept = record();
    await upload([copy(drive), copy(kept)]);
    await upload([copy(drive, { groupId: workId })], { groupId: workId });

    await expect(
      caller(viewerId, viewerDeviceId).drives.delete({ driveIds: [drive.driveId] }),
    ).resolves.toEqual({ deleted: 0 });
    expect(await prisma.driveCopy.count({ where: { driveId: drive.driveId } })).toBe(2);

    await expect(
      caller(driverId, tabletDeviceId).drives.delete({ driveIds: [drive.driveId] }),
    ).resolves.toEqual({ deleted: 2 });
    expect(await prisma.driveCopy.count({ where: { driveId: drive.driveId } })).toBe(0);
    expect((await listDrives()).map(({ driveId }) => driveId)).toEqual([kept.driveId]);
  });

  test("a passenger mark replaces every copy under the same Epoch and Drive ID", async () => {
    const drive = record();
    const family = copy(drive, { epoch: 1 });
    await upload([family]);
    await upload([copy(drive, { groupId: workId })], { groupId: workId });
    const marked = markPassengerDrive(drive);
    const replacement = (groupId: string, epoch: number) => {
      const { ciphertext, nonce } = copy(marked, { groupId, epoch });
      return { ciphertext, groupId, nonce };
    };

    await expect(
      caller(driverId, tabletDeviceId).drives.replace({
        driveId: drive.driveId,
        copies: [replacement(familyId, 1)],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller(viewerId, viewerDeviceId).drives.replace({
        driveId: drive.driveId,
        copies: [replacement(familyId, 1), replacement(workId, 2)],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await caller(driverId, tabletDeviceId).drives.replace({
      driveId: drive.driveId,
      copies: [replacement(familyId, 1), replacement(workId, 2)],
    });
    const [listed] = await listDrives();
    if (!listed) throw new Error("Drive not listed.");
    expect(listed.epochId).toBe(family.epochId);
    expect(listed.replacedAt).toBeInstanceOf(Date);
    const opened = openDriveRecord({
      epochId: listed.epochId,
      epochKey: epochKeys.get(listed.epochId) ?? generateGroupEpochKey(),
      groupId: familyId,
      sealed: listed,
      senderDeviceId: listed.senderDeviceId,
    });
    expect(opened).toEqual(marked);
    expect(opened.events).toEqual([]);
    expect(opened.counts.HARD_BRAKING).toBe(0);
    expect(opened.distance).toBe(drive.distance);
  });

  test("leaving a Group deletes the leaver's Drives there", async () => {
    await upload([copy(record(), { groupId: workId, senderDeviceId: lateDeviceId })], {
      groupId: workId,
      userId: lateId,
      deviceId: lateDeviceId,
    });
    await upload([copy(record(), { groupId: workId })], { groupId: workId });
    const leaver = await prisma.groupMember.findUniqueOrThrow({
      where: { userId_groupId: { userId: lateId, groupId: workId } },
    });
    await caller(lateId, lateDeviceId).groupMembership.remove({
      groupId: workId,
      memberId: leaver.id,
    });
    expect(
      (await prisma.driveCopy.findMany({ where: { groupId: workId } })).map(
        ({ senderUserId }) => senderUserId,
      ),
    ).toEqual([driverId]);
  });
});
