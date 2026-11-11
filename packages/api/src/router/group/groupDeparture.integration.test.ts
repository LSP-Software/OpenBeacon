import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
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

const router = createTRPCRouter({
  groupInvites: groupInvitesRouter,
  groupEpoch: groupEpochRouter,
  groupLifecycle: groupLifecycleRouter,
  groupMembership: groupMembershipRouter,
  groupTracking: groupTrackingRouter,
});
const cache = createIntegrationTestCache(() => 0);
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
const caller = (userId: string, deviceId: string) =>
  router.createCaller({
    cache,
    db: prisma,
    clientIp: "127.0.0.1",
    deviceId,
    session: { user: { id: userId }, session: { id: `${userId}-session` } },
  } as Parameters<typeof router.createCaller>[0]);
const owner = caller(ownerId, ownerDevice);
const member = caller(memberId, memberDevice);
const bundle = (result: ReturnType<typeof createInitialGroupEpoch>) => ({
  createdByDeviceId: result.epoch.createdByDeviceId,
  epochId: result.epoch.epochId,
  epochNumber: result.epoch.epochNumber,
  historyKeys: [],
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
      await prisma.session.createMany({
        data: [ownerId, memberId].map((userId) => ({
          id: `${userId}-session`,
          token: `${userId}-token`,
          userId,
          expiresAt: new Date(Date.now() + 60_000),
        })),
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
            name: "Phone",
            icon: "phone",
            activatedAt: new Date(),
          },
        });
      }
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
      await prisma.$disconnect();
    });

    test("leave deletes tracking and device wraps, rotates keys, prevents old uploads after rejoining and protects the last owner", async () => {
      const devices = await prisma.userDevice.findMany({ where: { id: ownerDevice } });
      const initial = createInitialGroupEpoch({
        creator: { deviceId: ownerDevice, privateKey: ownerKey.privateKey },
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
        creator: { deviceId: memberDevice, privateKey: memberKey.privateKey },
        previousEpoch: joinContext.latestEpoch!,
        recipients: joinContext.recipients,
      });
      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: true } });
      await member.groupInvites.accept({ inviteId: invite!.id, nextEpoch: bundle(joined) });
      expect(
        (await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).epochRotationRequired,
      ).toBe(false);
      const alerts = await owner.groupInvites.joinAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.memberName).toBe("Member");
      expect(await member.groupInvites.joinAlerts()).toHaveLength(0);
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
      const { deviceWrap: wrapped } = await owner.groupEpoch.getEpochKeyWraps({
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
        creator: { deviceId: memberDevice, privateKey: memberKey.privateKey },
        previousEpoch: context.latestEpoch!,
        recipients: context.recipients,
      });
      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: true } });
      await member.groupMembership.remove({ groupId, memberId: self.id, nextEpoch: bundle(next) });
      expect(
        (await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).epochRotationRequired,
      ).toBe(false);
      expect((await owner.groupTracking.poll({ groupId })).points).toHaveLength(0);
      expect(
        (await owner.groupMembership.members({ groupId })).map((item) => item.user.id),
      ).toEqual([ownerId]);
      expect(
        await prisma.groupEpochRecipientKey.count({
          where: { groupEpoch: { groupId }, recipientDeviceId: memberDevice },
        }),
      ).toBe(0);
      expect(
        await prisma.groupEpochRecipientKey.count({
          where: { groupEpochId: joined.epoch.epochId, recipientDeviceId: ownerDevice },
        }),
      ).toBe(1);
      await expect(
        member.groupTracking.uploadBatch({ groupId, points: [point] }),
      ).rejects.toThrow();
      await owner.groupInvites.send({ groupId, invites: [{ email: memberEmail, role: "MEMBER" }] });
      const reinvite = (await member.groupInvites.list())[0]!;
      const rejoin = await member.groupInvites.acceptanceContext({ inviteId: reinvite.id });
      const rejoined = createNextGroupEpoch({
        creator: { deviceId: memberDevice, privateKey: memberKey.privateKey },
        previousEpoch: rejoin.latestEpoch!,
        recipients: rejoin.recipients,
      });
      await member.groupInvites.accept({ inviteId: reinvite.id, nextEpoch: bundle(rejoined) });
      expect(
        await prisma.groupEpochRecipientKey.count({
          where: { groupEpoch: { groupId }, recipientDeviceId: memberDevice },
        }),
      ).toBe(1);
      expect(
        (
          await member.groupEpoch.getEpochKeyWraps({
            groupId,
            deviceId: memberDevice,
            epochId: joined.epoch.epochId,
          })
        ).deviceWrap,
      ).toBeNull();
      const rejoinedWraps = await member.groupEpoch.listEpochKeyWraps({
        groupId,
        deviceId: memberDevice,
      });
      expect(rejoinedWraps.epochs.map((epoch) => epoch.epochId)).toEqual([rejoined.epoch.epochId]);
      await expect(
        member.groupTracking.uploadBatch({ groupId, points: [point] }),
      ).rejects.toThrow();
      const ownerContext = await owner.groupMembership.removalContext({
        groupId,
        memberId: ownerMember.id,
      });
      const ownerNext = createNextGroupEpoch({
        creator: { deviceId: ownerDevice, privateKey: ownerKey.privateKey },
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
        creator: { deviceId: ownerDevice, privateKey: ownerKey.privateKey },
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
      await owner.groupInvites.send({ groupId, invites: [{ email: memberEmail, role: "MEMBER" }] });
      const finalInvite = (await member.groupInvites.list())[0]!;
      const finalJoin = await member.groupInvites.acceptanceContext({ inviteId: finalInvite.id });
      const finalJoined = createNextGroupEpoch({
        creator: { deviceId: memberDevice, privateKey: memberKey.privateKey },
        previousEpoch: finalJoin.latestEpoch!,
        recipients: finalJoin.recipients,
      });
      await member.groupInvites.accept({
        inviteId: finalInvite.id,
        nextEpoch: bundle(finalJoined),
      });
      const finalMembers = await owner.groupMembership.members({ groupId });
      const successor = finalMembers.find((item) => item.user.id === memberId)!;
      const finalContext = await owner.groupMembership.removalContext({
        groupId,
        memberId: ownerMember.id,
      });
      const finalEpoch = createNextGroupEpoch({
        creator: { deviceId: ownerDevice, privateKey: ownerKey.privateKey },
        previousEpoch: finalContext.latestEpoch!,
        recipients: finalContext.recipients,
      });
      const transfer = {
        groupId,
        memberId: ownerMember.id,
        successorMemberId: successor.id,
        nextEpoch: bundle(finalEpoch),
      };
      await expect(
        member.groupMembership.remove({
          ...transfer,
          memberId: successor.id,
          successorMemberId: ownerMember.id,
        }),
      ).rejects.toThrow("Only a departing owner");
      await expect(
        owner.groupMembership.remove({ ...transfer, successorMemberId: "missing" }),
      ).rejects.toThrow("Successor not found");
      await expect(
        owner.groupMembership.remove({
          ...transfer,
          nextEpoch: { ...transfer.nextEpoch, epochNumber: 999 },
        }),
      ).rejects.toThrow();
      expect(
        (await owner.groupMembership.members({ groupId })).find((item) => item.id === successor.id)
          ?.role,
      ).toBe("MEMBER");
      await owner.groupMembership.remove(transfer);
      expect(
        (await member.groupMembership.members({ groupId })).find(
          (item) => item.user.id === memberId,
        )?.role,
      ).toBe("OWNER");
      await member.groupInvites.send({ groupId, invites: [{ email: ownerEmail, role: "MEMBER" }] });
      expect(await owner.groupInvites.list()).toHaveLength(1);
    }, 45000);
  },
);
