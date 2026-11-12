import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { type Prisma, prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
  encryptGroupPayload,
} from "@openbeacon/encryption";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import { holdRowLock } from "../../lib/databaseLocks.testUtil.ts";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupEpochRouter } from "./groupEpochRouter.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";

setDefaultTimeout(60_000);

const router = createTRPCRouter({
  groupEpoch: groupEpochRouter,
  groupInvites: groupInvitesRouter,
  groupLifecycle: groupLifecycleRouter,
  groupMembership: groupMembershipRouter,
  groupTracking: groupTrackingRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `upload-concurrency-${crypto.randomUUID()}`;
const ownerId = `${prefix}-owner`;
const memberId = `${prefix}-member`;
const ownerDevice = `${prefix}-owner-device`;
const memberDevice = `${prefix}-member-device`;
const memberEmail = `${memberId}@example.test`;
const keys = { [ownerDevice]: createDeviceKeyPair(), [memberDevice]: createDeviceKeyPair() };
const caller = (userId: string, deviceId: string) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId,
      session: { user: { id: userId }, session: { id: `${userId}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );
const owner = caller(ownerId, ownerDevice);
const member = caller(memberId, memberDevice);
const bundle = (result: ReturnType<typeof createInitialGroupEpoch>) => ({
  createdByDeviceId: result.epoch.createdByDeviceId,
  epochId: result.epoch.epochId,
  epochNumber: result.epoch.epochNumber,
  historyKeys: [],
  recipientKeys: result.wrappedKeys,
});

const createGroup = async () => {
  const groupId = `${prefix}-group-${crypto.randomUUID()}`;
  const ownerKey = await prisma.userDevice.findUniqueOrThrow({ where: { id: ownerDevice } });
  const initial = createInitialGroupEpoch({
    creator: { deviceId: ownerDevice, privateKey: keys[ownerDevice].privateKey },
    groupId,
    recipients: [
      {
        algorithm: "X25519",
        createdAt: ownerKey.createdAt,
        deviceId: ownerDevice,
        publicKey: ownerKey.publicKey,
        revokedAt: null,
        userId: ownerId,
      },
    ],
  });
  await owner.groupLifecycle.create({ groupId, name: "Family", initialEpoch: bundle(initial) });
  await owner.groupInvites.send({ groupId, invites: [{ email: memberEmail, role: "MEMBER" }] });
  const invite = (await member.groupInvites.list()).find((item) => item.group.id === groupId)!;
  const context = await member.groupInvites.acceptanceContext({ inviteId: invite.id });
  const joined = createNextGroupEpoch({
    creator: { deviceId: memberDevice, privateKey: keys[memberDevice].privateKey },
    previousEpoch: context.latestEpoch!,
    recipients: context.recipients,
  });
  await member.groupInvites.accept({ inviteId: invite.id, nextEpoch: bundle(joined) });
  const point = (deviceId: string, clientPointId: string) => ({
    ...encryptGroupPayload({
      epochId: joined.epoch.epochId,
      epochKey: joined.epochKey,
      groupId,
      kind: TRACKING_POINT_KIND,
      payload: { latitude: 51.5, longitude: -0.12 },
      senderDeviceId: deviceId,
    }),
    clientPointId,
  });
  return { groupId, epochId: joined.epoch.epochId, point };
};

const nextEpochFor = async (groupId: string) => {
  await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: true } });
  const context = await owner.groupEpoch.rotationContext({ groupId });
  const next = createNextGroupEpoch({
    creator: { deviceId: ownerDevice, privateKey: keys[ownerDevice].privateKey },
    previousEpoch: context!.latestEpoch!,
    recipients: context!.recipients,
  });
  return bundle(next);
};

const settledState = async (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(
      () => "settled",
      () => "settled",
    ),
    Bun.sleep(200).then(() => "pending"),
  ]);

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "concurrent group uploads with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: [ownerId, memberId].map((id) => ({
          id,
          name: id,
          email: `${id}@example.test`,
        })),
      });
      await prisma.session.createMany({
        data: [ownerId, memberId].map((userId) => ({
          id: `${userId}-session`,
          token: `${userId}-token`,
          userId,
          expiresAt: new Date(Date.now() + 600_000),
        })),
      });
      for (const [userId, deviceId] of [
        [ownerId, ownerDevice],
        [memberId, memberDevice],
      ] as const) {
        await prisma.userDevice.create({
          data: {
            id: deviceId,
            userId,
            publicKey: keys[deviceId].publicKey,
            publicKeyAlgorithm: keys[deviceId].algorithm,
            name: "Phone",
            icon: "phone",
            activatedAt: new Date(),
          },
        });
      }
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
      await prisma.$disconnect();
    });

    test("an upload does not wait for another upload in progress in the same group", async () => {
      const { groupId, point } = await createGroup();
      const inFlight = await holdRowLock({
        db: prisma,
        id: groupId,
        mode: "FOR SHARE",
        table: "Group",
      });
      try {
        const result = await member.groupTracking.uploadBatch({
          groupId,
          points: [point(memberDevice, `${prefix}-alongside`)],
        });
        expect(result.accepted).toEqual([`${prefix}-alongside`]);
      } finally {
        await inFlight.release();
      }
    });

    test("uploads sharing points cannot deadlock however each batch is ordered", async () => {
      const { groupId, epochId, point } = await createGroup();
      const stored = (clientPointId: string) => (tx: Prisma.TransactionClient) =>
        tx.groupEncryptedPayload.create({
          data: {
            ...point(memberDevice, clientPointId),
            epochId,
            groupId,
            senderDeviceId: memberDevice,
            senderUserId: memberId,
          },
        });
      const first = `${prefix}-shared-a`;
      const second = `${prefix}-shared-b`;
      const inFlight = await holdRowLock({
        db: prisma,
        id: groupId,
        mode: "FOR SHARE",
        table: "Group",
        afterLock: stored(first),
        beforeCommit: stored(second),
      });
      const upload = member.groupTracking.uploadBatch({
        groupId,
        points: [point(memberDevice, second), point(memberDevice, first)],
      });
      await inFlight.waitForWaiters(1);
      await inFlight.release();

      await upload;
      expect(
        await prisma.groupEncryptedPayload.count({
          where: { groupId, clientPointId: { in: [first, second] } },
        }),
      ).toBe(2);
    });

    test("an upload waits for a group change that holds the group", async () => {
      const { groupId, point } = await createGroup();
      const change = await holdRowLock({ db: prisma, id: groupId, table: "Group" });
      const upload = member.groupTracking.uploadBatch({
        groupId,
        points: [point(memberDevice, `${prefix}-after-change`)],
      });
      await change.waitForWaiters(1);
      expect(await settledState(upload)).toBe("pending");
      await change.release();
      expect((await upload).accepted).toEqual([`${prefix}-after-change`]);
    });

    test("a key rotation waits for an upload in progress and keeps its point", async () => {
      const { groupId, epochId, point } = await createGroup();
      const nextEpoch = await nextEpochFor(groupId);
      const clientPointId = `${prefix}-before-rotation`;
      const stored = point(ownerDevice, clientPointId);
      const inFlight = await holdRowLock({
        db: prisma,
        id: groupId,
        mode: "FOR SHARE",
        table: "Group",
        beforeCommit: (tx) =>
          tx.groupEncryptedPayload.create({
            data: {
              ...stored,
              epochId,
              groupId,
              senderDeviceId: ownerDevice,
              senderUserId: ownerId,
            },
          }),
      });
      const rotation = owner.groupEpoch.rotate({ groupId, nextEpoch });
      await inFlight.waitForWaiters(1);
      expect(await settledState(rotation)).toBe("pending");
      await inFlight.release();
      expect(await rotation).toEqual({ rotated: true });
      expect(await prisma.groupEncryptedPayload.count({ where: { clientPointId } })).toBe(1);
    });

    test("removing a member waits for their upload in progress and still deletes its point", async () => {
      const { groupId, epochId, point } = await createGroup();
      const memberRow = await prisma.groupMember.findUniqueOrThrow({
        where: { userId_groupId: { userId: memberId, groupId } },
      });
      const removal = await owner.groupMembership.removalContext({
        groupId,
        memberId: memberRow.id,
      });
      const nextEpoch = bundle(
        createNextGroupEpoch({
          creator: { deviceId: ownerDevice, privateKey: keys[ownerDevice].privateKey },
          previousEpoch: removal.latestEpoch!,
          recipients: removal.recipients,
        }),
      );
      const inFlight = await holdRowLock({
        db: prisma,
        id: groupId,
        mode: "FOR SHARE",
        table: "Group",
        beforeCommit: (tx) =>
          tx.groupEncryptedPayload.create({
            data: {
              ...point(memberDevice, `${prefix}-during-removal`),
              epochId,
              groupId,
              senderDeviceId: memberDevice,
              senderUserId: memberId,
            },
          }),
      });
      const removing = owner.groupMembership.remove({
        groupId,
        memberId: memberRow.id,
        nextEpoch,
      });
      await inFlight.waitForWaiters(1);
      expect(await settledState(removing)).toBe("pending");
      await inFlight.release();
      await removing;

      expect(
        await prisma.groupEncryptedPayload.count({ where: { groupId, senderUserId: memberId } }),
      ).toBe(0);
      await expect(
        member.groupTracking.uploadBatch({
          groupId,
          points: [point(memberDevice, `${prefix}-after-removal`)],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    test("overlapping uploads, retries and a rotation store every point once without deadlocking", async () => {
      const { groupId, point } = await createGroup();
      const nextEpoch = await nextEpochFor(groupId);
      const pointsFor = (deviceId: string) =>
        Array.from({ length: 24 }, (_, index) =>
          point(deviceId, `${prefix}-${deviceId}-${String(index).padStart(2, "0")}`),
        );
      const owned = pointsFor(ownerDevice);
      const members = pointsFor(memberDevice);
      const batches = (points: typeof owned) =>
        Array.from({ length: 10 }, (_, index) => {
          const batch = points.slice(index * 2, index * 2 + 6);
          return index % 2 === 0 ? batch : [...batch].reverse();
        });

      const results = await Promise.allSettled([
        ...batches(owned).map((points) => owner.groupTracking.uploadBatch({ groupId, points })),
        ...batches(members).map((points) => member.groupTracking.uploadBatch({ groupId, points })),
        owner.groupEpoch.rotate({ groupId, nextEpoch }),
        member.groupTracking.poll({ groupId }),
      ]);

      expect(results.filter((result) => result.status === "rejected")).toEqual([]);
      const stored = await prisma.groupEncryptedPayload.groupBy({
        by: ["clientPointId"],
        where: { groupId },
        _count: true,
      });
      expect(stored.every(({ _count }) => _count === 1)).toBe(true);
      expect(stored.map(({ clientPointId }) => clientPointId).sort()).toEqual(
        [...owned, ...members].map(({ clientPointId }) => clientPointId).sort(),
      );
    });
  },
);
