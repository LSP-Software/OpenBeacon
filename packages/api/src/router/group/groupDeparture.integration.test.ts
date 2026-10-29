import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
  decodeJsonPayload,
  decryptGroupPayload,
  encryptGroupPayload,
  unwrapEpochKey,
} from "@openbeacon/encryption";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupEpochRouter } from "./groupEpochRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";
import { groupTrackingRouter } from "./groupTrackingRouter.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const router = createTRPCRouter({
  groupInvites: groupInvitesRouter,
  groupEpoch: groupEpochRouter,
  groupLifecycle: groupLifecycleRouter,
  groupMembership: groupMembershipRouter,
  groupTracking: groupTrackingRouter,
});
const cache = new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 });
const prefix = `departure-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const ownerId = `${prefix}-owner`;
const memberId = `${prefix}-member`;
const ownerDevice = `${prefix}-owner-device`;
const memberDevice = `${prefix}-member-device`;
const ownerEmail = `${ownerId}@example.test`;
const memberEmail = `${memberId}@example.test`;
const ownerKey = createDeviceKeyPair();
const memberKey = createDeviceKeyPair();
const caller = (userId: string) =>
  router.createCaller({
    cache,
    db: prisma,
    clientIp: "127.0.0.1",
    session: { user: { id: userId } },
  } as Parameters<typeof router.createCaller>[0]);
const owner = caller(ownerId);
const member = caller(memberId);
const bundle = (result: ReturnType<typeof createInitialGroupEpoch>) => ({
  createdByDeviceId: result.epoch.createdByDeviceId,
  epochId: result.epoch.epochId,
  epochNumber: result.epoch.epochNumber,
  recipientKeys: result.wrappedKeys,
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "group departure with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: [
          { id: ownerId, name: "Owner", email: ownerEmail },
          { id: memberId, name: "Member", email: memberEmail },
        ],
      });
      for (const [userId, deviceId, key] of [
        [ownerId, ownerDevice, ownerKey],
        [memberId, memberDevice, memberKey],
      ] as const) {
        await prisma.userDevice.create({
          data: {
            id: deviceId,
            userId,
            publicKey: key.publicKey,
            publicKeyAlgorithm: key.algorithm,
          },
        });
      }
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
      await prisma.$disconnect();
    });

    test("leave deletes tracking, rotates keys, prevents old uploads after rejoining and protects the last owner", async () => {
      const devices = await prisma.userDevice.findMany({ where: { id: ownerDevice } });
      const initial = createInitialGroupEpoch({
        createdByDeviceId: ownerDevice,
        groupId,
        recipients: devices.map((device) => ({
          algorithm: "X25519",
          createdAt: device.createdAt,
          deviceId: device.id,
          publicKey: device.publicKey,
          revokedAt: device.revokedAt,
          userId: device.userId,
        })),
      });
      await owner.groupLifecycle.create({ groupId, name: "Family", initialEpoch: bundle(initial) });
      await owner.groupInvites.send({ groupId, invites: [{ email: memberEmail, role: "MEMBER" }] });
      const invite = (await member.groupInvites.list())[0];
      expect(invite).toBeDefined();
      const joinContext = await member.groupInvites.acceptanceContext({ inviteId: invite!.id });
      const joined = createNextGroupEpoch({
        createdByDeviceId: memberDevice,
        previousEpoch: joinContext.latestEpoch!,
        recipients: joinContext.recipients,
      });
      await member.groupInvites.accept({ inviteId: invite!.id, nextEpoch: bundle(joined) });
      const plaintext = { latitude: 51.5, longitude: -0.12 };
      const encrypted = encryptGroupPayload({
        epochId: joined.epoch.epochId,
        epochKey: joined.epochKey,
        groupId,
        kind: TRACKING_POINT_KIND,
        payload: plaintext,
        senderDeviceId: memberDevice,
      });
      const point = {
        ...encrypted,
        clientPointId: `${prefix}-point`,
      };
      await member.groupTracking.uploadBatch({ groupId, points: [point] });
      const polled = (await owner.groupTracking.poll({ groupId })).points;
      expect(polled).toHaveLength(1);
      const wrapped = await owner.groupEpoch.getWrappedKey({
        groupId,
        deviceId: ownerDevice,
        epochId: joined.epoch.epochId,
      });
      expect(wrapped).not.toBeNull();
      const receivedKey = unwrapEpochKey({
        recipientDeviceId: ownerDevice,
        recipientPrivateKey: ownerKey.privateKey,
        wrappedEpochKey: wrapped!,
      });
      const received = decryptGroupPayload({
        encryptedPayload: { ...polled[0]!, groupId },
        epochKey: receivedKey,
        expectedMetadata: {
          groupId,
          epochId: joined.epoch.epochId,
          kind: TRACKING_POINT_KIND,
          senderDeviceId: memberDevice,
        },
      });
      expect(decodeJsonPayload(received.bytes)).toEqual(plaintext);
      const members = await member.groupMembership.members({ groupId });
      const self = members.find((item) => item.user.id === memberId)!;
      const ownerMember = members.find((item) => item.user.id === ownerId)!;
      await expect(
        member.groupMembership.removalContext({ groupId, memberId: ownerMember.id }),
      ).rejects.toThrow();
      const context = await member.groupMembership.removalContext({ groupId, memberId: self.id });
      const next = createNextGroupEpoch({
        createdByDeviceId: memberDevice,
        previousEpoch: context.latestEpoch!,
        recipients: context.recipients,
      });
      await member.groupMembership.remove({ groupId, memberId: self.id, nextEpoch: bundle(next) });
      expect((await owner.groupTracking.poll({ groupId })).points).toHaveLength(0);
      expect(
        (await owner.groupMembership.members({ groupId })).map((item) => item.user.id),
      ).toEqual([ownerId]);
      await expect(
        member.groupTracking.uploadBatch({ groupId, points: [point] }),
      ).rejects.toThrow();
      await owner.groupInvites.send({ groupId, invites: [{ email: memberEmail, role: "MEMBER" }] });
      const reinvite = (await member.groupInvites.list())[0]!;
      const rejoin = await member.groupInvites.acceptanceContext({ inviteId: reinvite.id });
      const rejoined = createNextGroupEpoch({
        createdByDeviceId: memberDevice,
        previousEpoch: rejoin.latestEpoch!,
        recipients: rejoin.recipients,
      });
      await member.groupInvites.accept({ inviteId: reinvite.id, nextEpoch: bundle(rejoined) });
      await expect(
        member.groupTracking.uploadBatch({ groupId, points: [point] }),
      ).rejects.toThrow();
      const ownerContext = await owner.groupMembership.removalContext({
        groupId,
        memberId: ownerMember.id,
      });
      const ownerNext = createNextGroupEpoch({
        createdByDeviceId: ownerDevice,
        previousEpoch: ownerContext.latestEpoch!,
        recipients: ownerContext.recipients,
      });
      await expect(
        owner.groupMembership.remove({
          groupId,
          memberId: ownerMember.id,
          nextEpoch: bundle(ownerNext),
        }),
      ).rejects.toThrow("Cannot remove the only owner");
      expect((await owner.groupMembership.members({ groupId })).length).toBe(2);

      const rejoinedMember = (await owner.groupMembership.members({ groupId })).find(
        (item) => item.user.id === memberId,
      )!;
      const removal = await owner.groupMembership.removalContext({
        groupId,
        memberId: rejoinedMember.id,
      });
      const removalEpoch = createNextGroupEpoch({
        createdByDeviceId: ownerDevice,
        previousEpoch: removal.latestEpoch!,
        recipients: removal.recipients,
      });
      const results = await Promise.allSettled([
        owner.groupMembership.remove({
          groupId,
          memberId: rejoinedMember.id,
          nextEpoch: bundle(removalEpoch),
        }),
        member.groupTracking.uploadBatch({
          groupId,
          points: [
            { ...point, clientPointId: `${prefix}-concurrent`, epochId: rejoined.epoch.epochId },
          ],
        }),
      ]);
      expect(results[0]?.status).toBe("fulfilled");
      expect((await owner.groupTracking.poll({ groupId })).points).toHaveLength(0);
      expect(
        (await owner.groupMembership.members({ groupId })).map((item) => item.user.id),
      ).toEqual([ownerId]);
    }, 30000);
  },
);
