import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  encodePlaceGeometryV1,
  encryptGroupPayload,
  generateGroupEpochKey,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  PLACE_GEOMETRY_KIND,
  WRAPPED_EPOCH_KEY_ALGORITHM,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { linkRequestDevice } from "../../lib/requestDevice.ts";
import { storedEncryptedImageResponse } from "../../lib/storedEncryptedImage.testUtil.ts";
import { appRouter } from "../../root.ts";
import { s3Client } from "../../s3client.ts";

const cache = createIntegrationTestCache(() => Date.now());
const prefix = `adv-ac-${crypto.randomUUID()}`;
const aOwner = `${prefix}-a-owner`;
const aAdmin = `${prefix}-a-admin`;
const aMember = `${prefix}-a-member`;
const bOwner = `${prefix}-b-owner`;
const bMember = `${prefix}-b-member`;
const loner = `${prefix}-loner`;
const removed = `${prefix}-removed`;
const revokedUser = `${prefix}-revoked`;
const users = [aOwner, aAdmin, aMember, bOwner, bMember, loner, removed, revokedUser];
const groupA = `${prefix}-group-a`;
const groupB = `${prefix}-group-b`;
const epochA = `${prefix}-epoch-a`;
const epochB = `${prefix}-epoch-b`;
const placeA = `${prefix}-place-a`;
const placeB = `${prefix}-place-b`;
const bPendingDevice = `${prefix}-b-member-pending`;
const bLinkId = crypto.randomUUID();
const epochKey = generateGroupEpochKey();
const pushTokenValue = `${prefix}-push-token-secret`;
const bytes = (length: number) => Buffer.alloc(length, 7).toString("base64");
const nonce = bytes(24);

const deviceOf = (userId: string) => `${userId}-device`;
const sessionOf = (userId: string) => `${userId}-session`;

const caller = (userId: string) =>
  appRouter.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId: deviceOf(userId),
      unverifiedDeviceId: null,
      session: {
        user: { id: userId },
        session: { id: sessionOf(userId), createdAt: new Date(), userId },
      },
    }) as Parameters<typeof appRouter.createCaller>[0],
  );

const memberIdOf = async (userId: string, groupId: string) =>
  (
    await prisma.groupMember.findUniqueOrThrow({
      where: { userId_groupId: { userId, groupId } },
      select: { id: true },
    })
  ).id;

const sealGeometry = ({
  epochId,
  groupId,
  senderDeviceId,
}: {
  epochId: string;
  groupId: string;
  senderDeviceId: string;
}) => {
  const encrypted = encryptGroupPayload({
    epochId,
    epochKey,
    groupId,
    kind: PLACE_GEOMETRY_KIND,
    payload: encodePlaceGeometryV1({
      v: 1,
      latitude: 51.5,
      longitude: -0.12,
      radiusMeters: 150,
    }),
    senderDeviceId,
  });
  return {
    algorithm: encrypted.algorithm,
    ciphertext: encrypted.ciphertext,
    epochId,
    kind: PLACE_GEOMETRY_KIND,
    nonce: encrypted.nonce,
    senderDeviceId,
  };
};

const pictureKey = (userId: string, epochId: string) => ({
  algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
  ciphertext: `${userId}-picture-key`,
  epochId,
  nonce,
  senderDeviceId: deviceOf(userId),
});

const fakeEpochBundle = (userId: string, epochNumber: number) => {
  const epochId = `${prefix}-fake-epoch-${crypto.randomUUID()}`;
  return {
    createdByDeviceId: deviceOf(userId),
    epochId,
    epochNumber,
    historyKeys: [],
    recipientKeys: [
      {
        algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
        createdAt: new Date(),
        ephemeralPublicKey: bytes(32),
        epochId,
        recipientDeviceId: deviceOf(userId),
        senderPublicKey: bytes(32),
        wrappedKey: bytes(48),
      },
    ],
  };
};

const errorCodeOf = async (promise: Promise<unknown>) => {
  const result = await tryCatch(promise);
  if (!result.error) return "RESOLVED";
  return result.error instanceof TRPCError ? result.error.code : result.error.message;
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "adversarial access control across groups, users and devices",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: users.map((id) => ({ id, name: id, email: `${id}@example.test` })),
      });
      await prisma.userDevice.createMany({
        data: [
          ...users.map((userId) => ({
            activatedAt: new Date(),
            icon: "phone" as const,
            id: deviceOf(userId),
            name: `${userId} phone`,
            publicKey: bytes(32),
            publicKeyAlgorithm: "X25519",
            userId,
          })),
          {
            activatedAt: null,
            icon: "phone" as const,
            id: bPendingDevice,
            name: "B pending phone",
            publicKey: bytes(32),
            publicKeyAlgorithm: "X25519",
            userId: bMember,
          },
        ],
      });
      await prisma.session.createMany({
        data: users.map((userId) => ({
          id: sessionOf(userId),
          token: `${sessionOf(userId)}-token`,
          userId,
          deviceId: deviceOf(userId),
          expiresAt: new Date(Date.now() + 86_400_000),
        })),
      });
      await prisma.group.create({
        data: {
          id: groupA,
          name: "Group A",
          groupMembers: {
            create: [
              { userId: aOwner, role: "OWNER", joinedEpochNumber: 1 },
              { userId: aAdmin, role: "ADMIN", joinedEpochNumber: 1 },
              { userId: aMember, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
          groupEpochs: { create: [{ id: epochA, epochNumber: 1, senderPublicKey: bytes(32) }] },
        },
      });
      await prisma.group.create({
        data: {
          id: groupB,
          name: "Group B",
          groupMembers: {
            create: [
              { userId: bOwner, role: "OWNER", joinedEpochNumber: 1 },
              { userId: bMember, role: "MEMBER", joinedEpochNumber: 1 },
              { userId: removed, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
          groupEpochs: { create: [{ id: epochB, epochNumber: 1, senderPublicKey: bytes(32) }] },
        },
      });
      await prisma.groupMember.delete({
        where: { userId_groupId: { userId: removed, groupId: groupB } },
      });
      await prisma.groupEpochRecipientKey.createMany({
        data: [
          { groupEpochId: epochA, recipientDeviceId: deviceOf(aOwner) },
          { groupEpochId: epochB, recipientDeviceId: deviceOf(bMember) },
        ].map((key) => ({
          ...key,
          algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
          ephemeralPublicKey: bytes(32),
          wrappedKey: bytes(48),
        })),
      });
      for (const [id, groupId, epochId, userId] of [
        [placeA, groupA, epochA, aOwner],
        [placeB, groupB, epochB, bOwner],
      ] as const) {
        const geometry = sealGeometry({ epochId, groupId, senderDeviceId: deviceOf(userId) });
        await prisma.place.create({
          data: {
            id,
            groupId,
            name: groupId === groupA ? "A home" : "B home",
            emoji: "🏠",
            epochId,
            senderDeviceId: geometry.senderDeviceId,
            algorithm: geometry.algorithm,
            nonce: geometry.nonce,
            ciphertext: geometry.ciphertext,
            createdByUserId: userId,
          },
        });
      }
      await prisma.groupMember.update({
        where: { userId_groupId: { userId: bMember, groupId: groupB } },
        data: {
          imageKeyEpochId: epochB,
          imageKeySenderDeviceId: deviceOf(bMember),
          imageKeyAlgorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
          imageKeyNonce: nonce,
          imageKeyCiphertext: "b-member-picture-key",
        },
      });
      await prisma.user.update({
        where: { id: bMember },
        data: { image: `https://cdn.example.com/file/${crypto.randomUUID()}` },
      });
      await prisma.groupMemberInvite.create({
        data: {
          id: `${prefix}-invite-to-loner`,
          inviterId: bOwner,
          recipientId: loner,
          groupId: groupB,
          role: "MEMBER",
        },
      });
      await prisma.groupSharedInvite.create({
        data: {
          id: `${prefix}-shared-b`,
          codeHash: `${prefix}-shared-b-hash`,
          creatorId: bOwner,
          groupId: groupB,
          expiresAt: new Date(Date.now() + 300_000),
        },
      });
      await prisma.deviceLink.create({
        data: {
          id: bLinkId,
          userId: bMember,
          deviceId: bPendingDevice,
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
      await prisma.pushToken.createMany({
        data: [
          { deviceId: deviceOf(aOwner), token: `${pushTokenValue}-a` },
          { deviceId: deviceOf(bMember), token: `${pushTokenValue}-b` },
        ],
      });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { in: [groupA, groupB] } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    test("an outsider and a removed member are refused by every procedure scoped to the group", async () => {
      const bMemberId = await memberIdOf(bMember, groupB);
      for (const userId of [loner, removed]) {
        const as = caller(userId);
        const groupId = groupB;
        const attempts: Record<string, () => Promise<unknown>> = {
          "groupMembership.get": () => as.groupMembership.get({ groupId }),
          "groupMembership.members": () => as.groupMembership.members({ groupId }),
          "groupMembership.listMemberDevices": () =>
            as.groupMembership.listMemberDevices({ groupId }),
          "groupMembership.nicknames": () => as.groupMembership.nicknames({ groupId }),
          "groupMembership.removalContext": () =>
            as.groupMembership.removalContext({ groupId, memberId: bMemberId }),
          "groupMembership.updateNickname": () =>
            as.groupMembership.updateNickname({
              groupId,
              memberId: bMemberId,
              ciphertext: "x",
              expectedCiphertext: null,
            }),
          "groupMembership.updateColor": () =>
            as.groupMembership.updateColor({ groupId, ciphertext: "x" }),
          "groupPlaces.list": () => as.groupPlaces.list({ groupId }),
          "groupPlaces.delete": () => as.groupPlaces.delete({ groupId, placeId: placeB }),
          "groupTracking.poll": () => as.groupTracking.poll({ groupId }),
          "groupTracking.getLatest": () => as.groupTracking.getLatest({ groupId }),
          "groupTracking.historyDays": () => as.groupTracking.historyDays({ groupId }),
          "groupTracking.historyRange": () =>
            as.groupTracking.historyRange({ groupId, fromHour: 1, toHour: 2 }),
          "groupTracking.uploadBatch": () =>
            as.groupTracking.uploadBatch({ groupId, points: [], placeAlertsCursor: null }),
          "groupHistory.list": () => as.groupHistory.list({ groupId }),
          "placeTransitions.recent": () => as.placeTransitions.recent({ groupId }),
          "placeAlerts.mutes": () => as.placeAlerts.mutes({ groupId }),
          "placeAlerts.setMute": () =>
            as.placeAlerts.setMute({ groupId, placeId: placeB, mutedUserId: null, muted: true }),
          "placeSharing.get": () => as.placeSharing.get({ groupId }),
          "placeSharing.set": () => as.placeSharing.set({ groupId, enabled: false }),
          "groupEpoch.getLatest": () => as.groupEpoch.getLatest({ groupId }),
          "groupEpoch.rotationContext": () => as.groupEpoch.rotationContext({ groupId }),
          "groupEpoch.listRecipientPublicKeys": () =>
            as.groupEpoch.listRecipientPublicKeys({ groupId }),
          "groupEpoch.getEpochKeyWraps": () =>
            as.groupEpoch.getEpochKeyWraps({
              groupId,
              epochId: epochB,
              deviceId: deviceOf(bMember),
            }),
          "groupEpoch.listEpochKeyWraps": () =>
            as.groupEpoch.listEpochKeyWraps({ groupId, deviceId: deviceOf(bMember) }),
          "groupEpoch.listHistoryBackfill": () =>
            as.groupEpoch.listHistoryBackfill({ groupId, deviceId: deviceOf(userId) }),
          "groupImageKeys.reEncrypt": () =>
            as.groupImageKeys.reEncrypt({
              groupId,
              keys: [
                {
                  target: { kind: "member", memberId: bMemberId },
                  fileName: crypto.randomUUID(),
                  expectedCiphertext: "b-member-picture-key",
                  key: pictureKey(userId, epochB),
                },
              ],
            }),
          "groupInvites.sharedStatuses": () =>
            as.groupInvites.sharedStatuses({ groupId, inviteIds: [`${prefix}-shared-b`] }),
          "groupInvites.createShared": () => as.groupInvites.createShared({ groupId }),
          "groupSettings.rename": () => as.groupSettings.rename({ groupId, name: "Taken" }),
          "groupSettings.setHistoryShare": () =>
            as.groupSettings.setHistoryShare({ groupId, historyShare: null }),
          "groupSettings.requestGroupImageUpload": () =>
            as.groupSettings.requestGroupImageUpload({ groupId }),
        };
        const outcomes: Record<string, string> = {};
        for (const [name, attempt] of Object.entries(attempts)) {
          outcomes[name] = await errorCodeOf(attempt());
        }
        expect(outcomes).toEqual(
          Object.fromEntries(Object.keys(attempts).map((name) => [name, "FORBIDDEN"])),
        );
      }
      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupB } })).toMatchObject({
        name: "Group B",
      });
    });

    test("an admin of one group cannot reach another group's places by passing their own group id", async () => {
      const before = await prisma.place.findUniqueOrThrow({ where: { id: placeB } });
      const geometry = sealGeometry({
        epochId: epochA,
        groupId: groupA,
        senderDeviceId: deviceOf(aAdmin),
      });
      expect(
        await errorCodeOf(
          caller(aAdmin).groupPlaces.update({
            groupId: groupA,
            placeId: placeB,
            name: "Hijacked",
            emoji: "🏴",
            geometry,
            expectedCiphertext: before.ciphertext,
          }),
        ),
      ).toBe("NOT_FOUND");
      expect(
        await errorCodeOf(caller(aAdmin).groupPlaces.delete({ groupId: groupA, placeId: placeB })),
      ).toBe("NOT_FOUND");
      expect(
        await caller(aMember).groupPlaces.reEncrypt({
          groupId: groupA,
          places: [
            {
              placeId: placeB,
              name: before.name,
              emoji: before.emoji,
              expectedCiphertext: before.ciphertext,
              geometry: sealGeometry({
                epochId: epochA,
                groupId: groupA,
                senderDeviceId: deviceOf(aMember),
              }),
            },
          ],
        }),
      ).toMatchObject({ places: [], gone: [placeB] });
      expect(
        await errorCodeOf(
          caller(aMember).placeAlerts.setMute({
            groupId: groupA,
            placeId: placeB,
            mutedUserId: null,
            muted: true,
          }),
        ),
      ).toBe("NOT_FOUND");
      expect(
        await errorCodeOf(
          caller(aMember).placeAlerts.setMute({
            groupId: groupA,
            placeId: placeA,
            mutedUserId: bMember,
            muted: true,
          }),
        ),
      ).toBe("NOT_FOUND");
      const clientId = crypto.randomUUID();
      const upload = await caller(aMember).groupTracking.uploadBatch({
        groupId: groupA,
        points: [],
        placeTransitions: [
          {
            clientId,
            placeId: placeB,
            direction: "ARRIVE",
            occurredAt: new Date(),
            senderDeviceId: deviceOf(aMember),
          },
        ],
      });
      expect(upload).toMatchObject({ placeTransitions: { accepted: [], discarded: [clientId] } });
      expect(await prisma.place.findUniqueOrThrow({ where: { id: placeB } })).toEqual(before);
      expect(await prisma.placeTransition.count({ where: { placeId: placeB } })).toBe(0);
      expect(await prisma.placeAlertMute.count({ where: { placeId: placeB } })).toBe(0);
    });

    test("a member of one group cannot reach another group's members or epoch keys through their own group", async () => {
      const bMemberId = await memberIdOf(bMember, groupB);
      const bMemberBefore = await prisma.groupMember.findUniqueOrThrow({
        where: { id: bMemberId },
      });
      expect(
        await errorCodeOf(
          caller(aOwner).groupMembership.updateRole({
            groupId: groupA,
            memberId: bMemberId,
            role: "ADMIN",
          }),
        ),
      ).toBe("NOT_FOUND");
      expect(
        await errorCodeOf(
          caller(aOwner).groupMembership.removalContext({ groupId: groupA, memberId: bMemberId }),
        ),
      ).toBe("NOT_FOUND");
      expect(
        await errorCodeOf(
          caller(aOwner).groupMembership.remove({
            groupId: groupA,
            memberId: bMemberId,
            nextEpoch: fakeEpochBundle(aOwner, 2),
          }),
        ),
      ).toBe("NOT_FOUND");
      expect(
        await errorCodeOf(
          caller(aMember).groupMembership.updateNickname({
            groupId: groupA,
            memberId: bMemberId,
            ciphertext: "nickname",
            expectedCiphertext: null,
          }),
        ),
      ).toBe("NOT_FOUND");
      const bMemberImage = (await prisma.user.findUniqueOrThrow({ where: { id: bMember } })).image;
      expect(
        await caller(aMember).groupImageKeys.reEncrypt({
          groupId: groupA,
          keys: [
            {
              target: { kind: "member", memberId: bMemberId },
              fileName: bMemberImage?.split("/").at(-1) ?? crypto.randomUUID(),
              expectedCiphertext: "b-member-picture-key",
              key: pictureKey(aMember, epochA),
            },
          ],
        }),
      ).toMatchObject({ reEncrypted: [], gone: [{ kind: "member", memberId: bMemberId }] });
      expect(
        await caller(aMember).groupEpoch.getEpochKeyWraps({
          groupId: groupA,
          epochId: epochB,
          deviceId: deviceOf(bMember),
        }),
      ).toEqual({ deviceWrap: null, historyWraps: [] });
      expect(
        await caller(aMember).groupEpoch.getEpochKeyWraps({
          groupId: groupA,
          epochId: epochA,
          deviceId: deviceOf(aOwner),
        }),
      ).toEqual({ deviceWrap: null, historyWraps: [] });
      const listed = await caller(aMember).groupEpoch.listEpochKeyWraps({
        groupId: groupA,
        deviceId: deviceOf(aOwner),
      });
      expect(listed.epochs.map(({ deviceWrap }) => deviceWrap)).toEqual([null]);
      expect(
        await errorCodeOf(
          caller(aMember).groupEpoch.listHistoryBackfill({
            groupId: groupA,
            deviceId: deviceOf(aOwner),
          }),
        ),
      ).toBe("FORBIDDEN");
      expect(await prisma.groupMember.findUniqueOrThrow({ where: { id: bMemberId } })).toEqual(
        bMemberBefore,
      );
      expect(await prisma.personalGroupNickname.count({ where: { targetId: bMemberId } })).toBe(0);
    });

    test("invites addressed to someone else cannot be previewed, accepted or declined", async () => {
      const inviteId = `${prefix}-invite-to-loner`;
      const as = caller(aMember);
      expect({
        preview: await errorCodeOf(as.groupInvites.preview({ inviteId })),
        acceptanceContext: await errorCodeOf(as.groupInvites.acceptanceContext({ inviteId })),
        decline: await errorCodeOf(as.groupInvites.decline({ inviteId })),
        accept: await errorCodeOf(
          as.groupInvites.accept({ inviteId, nextEpoch: fakeEpochBundle(aMember, 2) }),
        ),
      }).toEqual({
        preview: "NOT_FOUND",
        acceptanceContext: "NOT_FOUND",
        decline: "NOT_FOUND",
        accept: "NOT_FOUND",
      });
      expect(
        await caller(aOwner).groupInvites.sharedStatuses({
          groupId: groupA,
          inviteIds: [`${prefix}-shared-b`],
        }),
      ).toEqual([]);
      expect(await prisma.groupMemberInvite.count({ where: { id: inviteId } })).toBe(1);
      expect(await prisma.groupMember.count({ where: { userId: aMember, groupId: groupB } })).toBe(
        0,
      );
    });

    test("another account's device links and devices cannot be read, approved, declined, renamed or removed", async () => {
      const as = caller(aMember);
      expect({
        get: await errorCodeOf(as.deviceLink.get({ linkId: bLinkId })),
        approve: await errorCodeOf(
          as.deviceLink.approve({ linkId: bLinkId, enc: bytes(32), ciphertext: bytes(64) }),
        ),
        decline: await errorCodeOf(as.deviceLink.decline({ linkId: bLinkId })),
        updateDevice: await errorCodeOf(
          as.account.updateDevice({ deviceId: deviceOf(bMember), name: "Mine now" }),
        ),
        removeDevice: await errorCodeOf(as.account.removeDevice({ deviceId: deviceOf(bMember) })),
        removePendingDevice: await errorCodeOf(
          as.account.removeDevice({ deviceId: bPendingDevice }),
        ),
      }).toEqual({
        get: "FORBIDDEN",
        approve: "FORBIDDEN",
        decline: "NOT_FOUND",
        updateDevice: "NOT_FOUND",
        removeDevice: "NOT_FOUND",
        removePendingDevice: "NOT_FOUND",
      });
      expect(await prisma.deviceLink.findUniqueOrThrow({ where: { id: bLinkId } })).toMatchObject({
        completedAt: null,
        approverDeviceId: null,
      });
      expect(
        await prisma.userDevice.findMany({
          where: { id: { in: [deviceOf(bMember), bPendingDevice] } },
          orderBy: { id: "asc" },
          select: { id: true, name: true, revokedAt: true, activatedAt: true },
        }),
      ).toMatchObject([
        { id: deviceOf(bMember), name: `${bMember} phone`, revokedAt: null },
        { id: bPendingDevice, revokedAt: null, activatedAt: null },
      ]);
    });

    test("only an owner or admin can confirm a group picture, even with a pending upload left over", async () => {
      const send = spyOn(s3Client, "send").mockImplementation(async (command) =>
        storedEncryptedImageResponse(command),
      );
      try {
        for (const userId of [aMember, loner]) {
          await prisma.pendingUpload.create({
            data: {
              userId,
              uploadType: "groupAvatar",
              groupId: groupA,
              fileName: crypto.randomUUID(),
            },
          });
          expect(
            await errorCodeOf(
              caller(userId).groupSettings.confirmGroupImageUpload({
                groupId: groupA,
                key: pictureKey(userId, epochA),
              }),
            ),
          ).toBe("FORBIDDEN");
        }
      } finally {
        send.mockRestore();
        await prisma.pendingUpload.deleteMany({ where: { groupId: groupA } });
      }
      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupA } })).toMatchObject({
        image: null,
        imageKeyCiphertext: null,
      });
      expect(
        await prisma.groupEvent.count({
          where: { groupId: groupA, type: "GROUP_IMAGE_CHANGED" },
        }),
      ).toBe(0);
    });

    test("member lists never carry emails, push tokens or people from other groups", async () => {
      const as = caller(aMember);
      const responses = {
        list: await as.groupMembership.list(),
        members: await as.groupMembership.members({ groupId: groupA }),
        devices: await as.groupMembership.listMemberDevices({ groupId: groupA }),
        recipients: await as.groupEpoch.listRecipientPublicKeys({ groupId: groupA }),
        viewers: await as.account.viewers(),
        history: await as.groupHistory.list({ groupId: groupA }),
        group: await as.groupMembership.get({ groupId: groupA }),
        sharing: await as.placeSharing.get({ groupId: groupA }),
        lonerInvites: await caller(loner).groupInvites.list(),
      };
      const serialized = JSON.stringify(responses);
      expect(serialized).not.toContain("@example.test");
      expect(serialized).not.toContain(pushTokenValue);
      expect(serialized).not.toContain(bMember);
      expect(serialized).not.toContain(removed);
      expect(serialized).not.toContain(sessionOf(aOwner));
      expect(Object.keys(responses.devices[0] ?? {}).sort()).toEqual([
        "deviceId",
        "icon",
        "name",
        "platform",
        "userId",
      ]);
      expect(responses.devices.map(({ userId }) => userId).sort()).toEqual(
        [aAdmin, aMember, aOwner].sort(),
      );
      expect(responses.lonerInvites).toEqual([
        {
          id: `${prefix}-invite-to-loner`,
          inviter: { id: bOwner, name: bOwner, image: null },
          group: { id: groupB, name: "Group B", image: null },
        },
      ]);
    });

    test("a revoked device's session is ended before it reaches any procedure", async () => {
      await prisma.userDevice.update({
        where: { id: deviceOf(revokedUser) },
        data: { revokedAt: new Date() },
      });
      expect(
        await linkRequestDevice({
          db: prisma,
          deviceId: deviceOf(revokedUser),
          session: { id: sessionOf(revokedUser), userId: revokedUser },
        }),
      ).toEqual({ removed: true });
      expect(await prisma.session.count({ where: { id: sessionOf(revokedUser) } })).toBe(0);
      expect(
        await linkRequestDevice({
          db: prisma,
          deviceId: deviceOf(bMember),
          session: { id: sessionOf(aMember), userId: aMember },
        }),
      ).toEqual({ removed: false, deviceId: null, unverifiedDeviceId: null, deviceActive: false });
    });
  },
);
