import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma, readDatabaseTime } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
  generateGroupEpochKey,
} from "@openbeacon/encryption";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { encryptedTrackingPoint, testClientPointId } from "../../lib/trackingPoints.testUtil.ts";
import { sessionFreshForMs } from "../../procedures/auth/runtime.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupHistoryRouter } from "./groupHistoryRouter.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";

const router = createTRPCRouter({
  groupHistory: groupHistoryRouter,
  groupInvites: groupInvitesRouter,
  groupLifecycle: groupLifecycleRouter,
  groupTracking: groupTrackingRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `clock-skew-${crypto.randomUUID()}`;
const ownerId = `${prefix}-owner`;
const joinerId = `${prefix}-joiner`;
const users = [ownerId, joinerId];
const keys = Object.fromEntries(users.map((id) => [id, createDeviceKeyPair()]));
const epochKey = generateGroupEpochKey();
const RealDate = Date;

const withApiClockOffset = async <T>(offsetMs: number, run: () => Promise<T>) => {
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args: unknown[]) =>
      args.length === 0
        ? new target(target.now() + offsetMs)
        : new (target as unknown as new (...values: unknown[]) => Date)(...args),
    get: (target, property) =>
      property === "now" ? () => target.now() + offsetMs : Reflect.get(target, property),
  });
  try {
    return await run();
  } finally {
    globalThis.Date = RealDate;
  }
};

const caller = (userId: string) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      deviceId: `${userId}-device`,
      session: { user: { id: userId }, session: { id: `${userId}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );

const bundle = (result: ReturnType<typeof createInitialGroupEpoch>) => ({
  createdByDeviceId: result.epoch.createdByDeviceId,
  epochId: result.epoch.epochId,
  epochNumber: result.epoch.epochNumber,
  historyKeys: [],
  recipientKeys: result.wrappedKeys,
});

const createGroup = async (groupId: string) => {
  const device = await prisma.userDevice.findUniqueOrThrow({ where: { id: `${ownerId}-device` } });
  const initialEpoch = bundle(
    createInitialGroupEpoch({
      creator: { deviceId: device.id, privateKey: keys[ownerId]!.privateKey },
      groupId,
      recipients: [
        {
          algorithm: "X25519",
          createdAt: device.createdAt,
          deviceId: device.id,
          publicKey: device.publicKey,
          revokedAt: device.revokedAt,
          userId: ownerId,
        },
      ],
    }),
  );
  await caller(ownerId).groupLifecycle.create({ groupId, name: "Family", initialEpoch });
  return initialEpoch.epochId;
};

const join = async (groupId: string) => {
  await prisma.groupMemberInvite.create({
    data: { groupId, recipientId: joinerId, inviterId: ownerId, role: "MEMBER" },
  });
  const [invite] = await caller(joinerId).groupInvites.list();
  const context = await caller(joinerId).groupInvites.acceptanceContext({ inviteId: invite!.id });
  const nextEpoch = bundle(
    createNextGroupEpoch({
      creator: { deviceId: `${joinerId}-device`, privateKey: keys[joinerId]!.privateKey },
      previousEpoch: context.latestEpoch!,
      recipients: context.recipients,
    }),
  );
  await caller(joinerId).groupInvites.accept({ inviteId: invite!.id, nextEpoch });
  return nextEpoch.epochId;
};

let pointSeed = 0;
const upload = (userId: string, groupId: string, epochId: string) => {
  const point = encryptedTrackingPoint({
    clientPointId: testClientPointId(`${prefix}-${pointSeed++}`),
    epochId,
    epochKey,
    groupId,
    senderDeviceId: `${userId}-device`,
  });
  return caller(userId).groupTracking.uploadBatch({ groupId, points: [point] });
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "uploads and reads when the API clock and the database clock disagree",
  () => {
    beforeAll(async () => {
      for (const userId of users) {
        await prisma.user.create({
          data: { id: userId, name: userId, email: `${userId}@example.test` },
        });
        await prisma.session.create({
          data: {
            id: `${userId}-session`,
            token: `${userId}-token`,
            userId,
            expiresAt: new Date(Date.now() + 600_000),
          },
        });
        await prisma.userDevice.create({
          data: {
            id: `${userId}-device`,
            userId,
            publicKey: keys[userId]!.publicKey,
            publicKeyAlgorithm: keys[userId]!.algorithm,
            name: "Phone",
            icon: "phone",
            activatedAt: new Date(),
          },
        });
      }
    });

    afterAll(async () => {
      globalThis.Date = RealDate;
      await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    test("a creator's first epoch is stamped by the database clock and accepted", async () => {
      const groupId = `${prefix}-created`;
      const epochId = await withApiClockOffset(-3_600_000, () => createGroup(groupId));
      const member = await prisma.groupMember.findUniqueOrThrow({
        where: { userId_groupId: { userId: ownerId, groupId } },
      });
      const epoch = await prisma.groupEpoch.findUniqueOrThrow({ where: { id: epochId } });
      expect(Math.abs(epoch.createdAt.getTime() - member.createdAt.getTime())).toBeLessThan(60_000);

      const result = await upload(ownerId, groupId, epochId);

      expect(result.accepted).toHaveLength(1);
      expect(result.expired).toEqual([]);
    });

    test("a joiner's epoch is accepted, an epoch from before they joined is expired and another group's epoch is refused", async () => {
      const groupId = `${prefix}-joined`;
      const firstEpochId = await createGroup(groupId);
      const joinEpochId = await withApiClockOffset(-50, () => join(groupId));
      const otherGroupEpochId = await createGroup(`${prefix}-other`);

      const joined = await upload(joinerId, groupId, joinEpochId);
      const beforeJoin = await upload(joinerId, groupId, firstEpochId);

      expect(joined.accepted).toHaveLength(1);
      expect(beforeJoin.accepted).toEqual([]);
      expect(beforeJoin.expired).toHaveLength(1);
      await expect(upload(joinerId, groupId, otherGroupEpochId)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Epoch does not belong to this group.",
      });
    });

    test("an arrival recorded now is kept while the API clock is an hour behind", async () => {
      const groupId = `${prefix}-arrival`;
      const epochId = await createGroup(groupId);
      const place = await prisma.place.create({
        data: {
          groupId,
          name: "Home",
          emoji: "🏠",
          epochId,
          senderDeviceId: `${ownerId}-device`,
          algorithm: "test",
          nonce: "nonce",
          ciphertext: "ciphertext",
          createdByUserId: ownerId,
        },
      });
      const clientId = crypto.randomUUID();

      const result = await withApiClockOffset(-3_600_000, () =>
        caller(ownerId).groupTracking.uploadBatch({
          groupId,
          points: [],
          placeTransitions: [
            {
              clientId,
              placeId: place.id,
              direction: "ARRIVE",
              occurredAt: new RealDate(),
              senderDeviceId: `${ownerId}-device`,
            },
          ],
        }),
      );

      expect(result.placeTransitions?.accepted).toEqual([clientId]);
      const stored = await prisma.placeTransition.findFirstOrThrow({ where: { clientId } });
      expect(
        Math.abs(stored.createdAt.getTime() - (await readDatabaseTime(prisma)).getTime()),
      ).toBeLessThan(60_000);
    });

    test("group history shows a new event while the API clock is past the history window", async () => {
      const groupId = `${prefix}-history`;
      await createGroup(groupId);
      const event = await prisma.groupEvent.create({
        data: {
          groupId,
          type: "GROUP_CREATED",
          actorUserId: joinerId,
          createdAt: await readDatabaseTime(prisma),
        },
      });

      const [history, latest] = await withApiClockOffset(15 * 86_400_000, () =>
        Promise.all([
          caller(ownerId).groupHistory.list({ groupId }),
          caller(ownerId).groupHistory.latest(),
        ]),
      );

      expect(history.items.map(({ id }) => id)).toContain(event.id);
      expect(latest.find((group) => group.groupId === groupId)?.latestAt).toEqual(event.createdAt);
    });

    test("a session signed in now stays fresh while the API clock is ahead", async () => {
      const signedInAt = await readDatabaseTime(prisma);

      const freshForMs = await withApiClockOffset(40 * 60_000, () =>
        sessionFreshForMs(prisma, signedInAt),
      );

      expect(freshForMs).toBeGreaterThan(29 * 60_000);
    });
  },
);
