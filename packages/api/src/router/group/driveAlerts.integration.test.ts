import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { FcmSendResult, WakeKind } from "@openbeacon/auth/fcm.ts";
import { createPushSender } from "@openbeacon/auth/push.ts";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  type DriveRecord,
  generateGroupEpochKey,
  openDriveRecord,
  sealDriveRecord,
} from "@openbeacon/encryption";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { notificationSettingsRouter } from "../notificationSettingsRouter.ts";
import { driveAlertsRouter } from "./driveAlertsRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";

const prefix = `drive-alerts-${crypto.randomUUID()}`;
const driverId = `${prefix}-driver`;
const viewerId = `${prefix}-viewer`;
const muterId = `${prefix}-muter`;
const quietId = `${prefix}-quiet`;
const laterId = `${prefix}-later`;
const users = [driverId, viewerId, muterId, quietId, laterId];
const devices = {
  driverPhone: { id: `${driverId}-phone`, userId: driverId },
  driverTablet: { id: `${driverId}-tablet`, userId: driverId },
  viewerPhone: { id: `${viewerId}-phone`, userId: viewerId },
  muterPhone: { id: `${muterId}-phone`, userId: muterId },
  quietPhone: { id: `${quietId}-phone`, userId: quietId },
  laterPhone: { id: `${laterId}-phone`, userId: laterId },
};
const familyId = `${prefix}-family`;
const workId = `${prefix}-work`;
const groupIds = [familyId, workId];
const epochKeys = new Map(
  groupIds.map((groupId) => [`${groupId}-epoch-1`, generateGroupEpochKey()]),
);
const cache = createIntegrationTestCache(() => 0);
const router = createTRPCRouter({
  driveAlerts: driveAlertsRouter,
  groupTracking: groupTrackingRouter,
  notificationSettings: notificationSettingsRouter,
});

let clock = Date.now();
const timers: { ms: number; run: () => void }[] = [];
const tasks: Promise<unknown>[] = [];
const woken: string[] = [];
const push = createPushSender({
  db: prisma,
  fcm: {
    send: async (token: string, kind: WakeKind = "sync"): Promise<FcmSendResult> => {
      woken.push(`${token.slice(0, -"-token".length)}:${kind}`);
      return { outcome: "sent" };
    },
  },
  setTimer: (run, ms) => timers.push({ ms, run }),
  runInBackground: (task) => tasks.push(task),
  now: () => clock,
});
const settle = async () => {
  while (tasks.length) await Promise.all(tasks.splice(0));
};
const runTimers = async () => {
  const ran: number[] = [];
  await settle();
  while (timers.length > 0) {
    const due = timers.splice(0);
    clock += Math.max(...due.map(({ ms }) => ms));
    for (const timer of due) timer.run();
    ran.push(...due.map(({ ms }) => ms));
    await settle();
  }
  return ran;
};

const caller = (device: { id: string; userId: string }) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      deviceId: device.id,
      push,
      securityAlerts: null,
      session: {
        user: { id: device.userId },
        session: { id: `${device.id}-session` },
      },
    }) as Parameters<typeof router.createCaller>[0],
  );

const HOUR_MS = 3_600_000;

const record = (): DriveRecord => {
  const end = Date.now() - 60_000;
  return {
    driveId: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex"),
    start: { time: end - 1_320_000, latitude: 51.5074, longitude: -0.1278 },
    end: { time: end, latitude: 51.5521, longitude: -0.0714 },
    distance: 14_000,
    checkedDistance: 14_000,
    duration: 1_320,
    topSpeed: 27.27,
    averageSpeed: 10.6,
    utcOffsetMinutes: 0,
    counts: {
      HARD_BRAKING: 0,
      RAPID_ACCELERATION: 0,
      SPEEDING: 0,
      PHONE_USE: 0,
    },
    passenger: false,
    speedLimitsChecked: true,
    tellGroup: true,
    events: [],
  };
};

const upload = async (drive: DriveRecord, groupId = familyId, device = devices.driverPhone) => {
  const epochId = `${groupId}-epoch-1`;
  const epochKey = epochKeys.get(epochId);
  if (!epochKey) throw new Error("Missing test epoch key.");
  const sealed = sealDriveRecord({
    epochId,
    epochKey,
    groupId,
    record: drive,
    senderDeviceId: device.id,
  });
  const result = await caller(device).groupTracking.uploadBatch({
    groupId,
    points: [],
    drives: [{ ...sealed, epochId, senderDeviceId: device.id }],
  });
  expect(result.drives?.accepted).toEqual([drive.driveId]);
};

const catchUp = async (device: { id: string; userId: string }, cursor: string | null) => {
  const result = await caller(device).groupTracking.uploadBatch({
    groupId: familyId,
    points: [],
    driveAlertsCursor: cursor,
  });
  if (!result.driveAlerts) throw new Error("No Drive alerts in the catch-up.");
  return result.driveAlerts;
};

const startCursors = async () =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(devices)
        .filter(([, device]) => device.userId !== laterId)
        .map(async ([name, device]) => [name, (await catchUp(device, null)).cursor]),
    ),
  ) as Record<Exclude<keyof typeof devices, "laterPhone">, string>;

const alertedDrives = async (device: { id: string; userId: string }, cursor: string) =>
  (await catchUp(device, cursor)).alerts.map(({ driveId, groupId }) => `${groupId}:${driveId}`);

const sortedWakes = () => [...woken].sort();

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "Drive alerts with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: users.map((id) => ({
          id,
          name: id,
          email: `${id}@example.test`,
          historyShare: "MAXIMUM" as const,
        })),
      });
      await prisma.userDevice.createMany({
        data: Object.values(devices).map((device) => ({
          ...device,
          publicKey: createDeviceKeyPair().publicKey,
          publicKeyAlgorithm: "X25519",
          name: "Phone",
          icon: "phone" as const,
          activatedAt: new Date(),
        })),
      });
      await prisma.pushToken.createMany({
        data: Object.values(devices).map(({ id }) => ({
          deviceId: id,
          token: `${id}-token`,
        })),
      });
      await prisma.session.createMany({
        data: Object.values(devices).map(({ id, userId }) => ({
          id: `${id}-session`,
          token: `${id}-session-token`,
          userId,
          deviceId: id,
          expiresAt: new Date(Date.now() + 86_400_000),
        })),
      });
      for (const groupId of groupIds) {
        await prisma.group.create({
          data: {
            id: groupId,
            name: groupId,
            groupMembers: {
              create: [driverId, viewerId, muterId, quietId].map((userId) => ({
                userId,
                role: userId === driverId ? ("OWNER" as const) : ("MEMBER" as const),
                joinedEpochNumber: 1,
                createdAt: new Date(Date.now() - HOUR_MS),
              })),
            },
          },
        });
        await prisma.groupEpoch.create({
          data: {
            id: `${groupId}-epoch-1`,
            groupId,
            epochNumber: 1,
            createdByDeviceId: devices.driverPhone.id,
            senderPublicKey: createDeviceKeyPair().publicKey,
          },
        });
      }
      await prisma.notificationSetting.create({
        data: { userId: quietId, type: "DRIVES", email: false, phone: false },
      });
    });

    beforeEach(async () => {
      await prisma.driveCopy.deleteMany({
        where: { groupId: { in: groupIds } },
      });
      await prisma.driveAlertMute.deleteMany({
        where: { groupId: { in: groupIds } },
      });
      await prisma.groupMember.deleteMany({ where: { userId: laterId } });
      for (const groupId of groupIds) {
        await cache.rateLimits.reset({
          namespace: "groupTracking.driveAllowance",
          identifier: {
            type: "deviceGroup",
            deviceId: devices.driverPhone.id,
            groupId,
          },
          limit: 50,
          windowMs: 86_400_000,
        });
      }
      await runTimers();
      woken.splice(0);
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    test("a finished Drive wakes other members after the settle with a plain sync, never the driver's own devices", async () => {
      await upload(record());

      expect(await runTimers()).toEqual([16_000, 1_000]);
      expect(sortedWakes()).toEqual(
        [`${devices.viewerPhone.id}:sync`, `${devices.muterPhone.id}:sync`].sort(),
      );
    });

    test("members get the sealed copy in their catch-up and can open it; the driver's devices get nothing", async () => {
      const cursors = await startCursors();
      const drive = record();
      await upload(drive);

      const { alerts } = await catchUp(devices.viewerPhone, cursors.viewerPhone);
      expect(alerts).toHaveLength(1);
      const [alert] = alerts;
      if (!alert) throw new Error("No alert.");
      expect(alert).toMatchObject({
        groupId: familyId,
        driveId: drive.driveId,
        senderUserId: driverId,
        senderDeviceId: devices.driverPhone.id,
      });
      expect(
        openDriveRecord({
          epochId: alert.epochId,
          epochKey: epochKeys.get(alert.epochId) ?? generateGroupEpochKey(),
          groupId: familyId,
          sealed: alert,
          senderDeviceId: alert.senderDeviceId,
        }),
      ).toEqual(drive);
      expect(await alertedDrives(devices.driverTablet, cursors.driverTablet)).toEqual([]);
      expect(await alertedDrives(devices.driverPhone, cursors.driverPhone)).toEqual([]);
    });

    test("muting one person stops their Drive alerts and wakes in that Group only", async () => {
      const cursors = await startCursors();
      await caller(devices.muterPhone).driveAlerts.setMute({
        groupId: familyId,
        mutedUserId: driverId,
        muted: true,
      });
      expect(
        await caller(devices.muterPhone).driveAlerts.mutes({
          groupId: familyId,
        }),
      ).toEqual({
        mutes: [{ mutedUserId: driverId }],
      });
      const family = record();
      const work = record();
      await upload(family);
      await upload(work, workId);
      await runTimers();

      expect(await alertedDrives(devices.muterPhone, cursors.muterPhone)).toEqual([
        `${workId}:${work.driveId}`,
      ]);
      expect(sortedWakes()).toEqual(
        [`${devices.viewerPhone.id}:sync`, `${devices.muterPhone.id}:sync`].sort(),
      );

      woken.splice(0);
      await upload(record());
      await runTimers();
      expect(woken).toEqual([`${devices.viewerPhone.id}:sync`]);

      await caller(devices.muterPhone).driveAlerts.setMute({
        groupId: familyId,
        mutedUserId: driverId,
        muted: false,
      });
      woken.splice(0);
      const again = record();
      await upload(again);
      await runTimers();
      expect(sortedWakes()).toEqual(
        [`${devices.viewerPhone.id}:sync`, `${devices.muterPhone.id}:sync`].sort(),
      );
    });

    test("Mute everyone covers people who join later", async () => {
      await caller(devices.muterPhone).driveAlerts.setMute({
        groupId: familyId,
        mutedUserId: null,
        muted: true,
      });
      await prisma.groupMember.create({
        data: {
          userId: laterId,
          groupId: familyId,
          role: "MEMBER",
          joinedEpochNumber: 1,
          createdAt: new Date(Date.now() - 60_000),
        },
      });
      const muterCursor = (await catchUp(devices.muterPhone, null)).cursor;
      const laterDrive = record();
      await upload(laterDrive, familyId, devices.laterPhone);
      await upload(record());
      await runTimers();

      expect(await alertedDrives(devices.muterPhone, muterCursor)).toEqual([]);
      expect(woken).not.toContain(`${devices.muterPhone.id}:sync`);
      expect(woken).toContain(`${devices.viewerPhone.id}:sync`);
    });

    test("a member who turned Drive alerts off is neither woken nor handed alerts", async () => {
      const cursors = await startCursors();
      await upload(record());
      await runTimers();

      expect(woken).not.toContain(`${devices.quietPhone.id}:sync`);
      expect(await alertedDrives(devices.quietPhone, cursors.quietPhone)).toEqual([]);
      const settings = await caller(devices.viewerPhone).notificationSettings.get();
      expect(settings.settings.find(({ type }) => type === "DRIVES")).toEqual({
        type: "DRIVES",
        email: null,
        phone: true,
      });
    });

    test("someone who joined after a Drive arrived gets no alert for it", async () => {
      const drive = record();
      await upload(drive);
      await prisma.groupMember.create({
        data: {
          userId: laterId,
          groupId: familyId,
          role: "MEMBER",
          joinedEpochNumber: 1,
        },
      });
      const cursor = new Date(Date.now() - 10 * 60_000).toISOString();

      expect(await alertedDrives(devices.laterPhone, `${cursor}|`)).toEqual([]);
      expect(await alertedDrives(devices.viewerPhone, `${cursor}|`)).toEqual([
        `${familyId}:${drive.driveId}`,
      ]);
    });

    test("nobody can mute themselves or someone outside the Group", async () => {
      await expect(
        caller(devices.viewerPhone).driveAlerts.setMute({
          groupId: familyId,
          mutedUserId: viewerId,
          muted: true,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        caller(devices.viewerPhone).driveAlerts.setMute({
          groupId: familyId,
          mutedUserId: laterId,
          muted: true,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        caller(devices.laterPhone).driveAlerts.mutes({ groupId: familyId }),
      ).rejects.toThrow();
    });
  },
);
