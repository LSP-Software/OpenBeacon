import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  createNextGroupEpoch,
  decodeJsonPayload,
  decryptGroupPayload,
  encodeBase64,
  encodePlaceGeometryV1,
  encryptGroupPayload,
  type EpochKeyMaterial,
  type GroupEpoch,
  generateGroupEpochKey,
  type HistoryPublicKey,
  PLACE_GEOMETRY_KIND,
  type PlaceGeometryV1,
  type RecipientPublicKeyMaterial,
  validatePlaceGeometryV1,
  WRAPPED_EPOCH_KEY_ALGORITHM,
  wrapEpochKeyForHistoryKey,
} from "@openbeacon/encryption";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { appRouter } from "../../root.ts";

setDefaultTimeout(60_000);

const cache = createIntegrationTestCache(() => 0);
const prefix = `adv-kd-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const placesGroupId = `${prefix}-places-group`;

const account = (name: string) => ({
  deviceId: `${prefix}-${name}-device`,
  history: createHistoryKeyPair(),
  historyKeyId: crypto.randomUUID(),
  key: createDeviceKeyPair(),
  userId: `${prefix}-${name}`,
});
const owner = account("owner");
const member = account("member");
const victim = account("victim");
const outsider = account("outsider");
const accounts = [owner, member, victim, outsider];
const victimPending = { deviceId: `${prefix}-victim-pending`, key: createDeviceKeyPair() };
const victimRevoked = { deviceId: `${prefix}-victim-revoked`, key: createDeviceKeyPair() };

const caller = (userId: string, deviceId: string | null, sessionId = `${userId}-session`) =>
  appRouter.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId,
      emailCodes: null,
      securityAlerts: null,
      serverVersion: "9.9.9",
      serverName: "Test server",
      selfHosted: true,
      session: {
        user: { id: userId, email: `${userId}@example.test` },
        session: { id: sessionId, createdAt: new Date() },
      },
    }) as Parameters<typeof appRouter.createCaller>[0],
  );

const api = (target: { deviceId: string; userId: string }) =>
  caller(target.userId, target.deviceId);

const fakeWrap = () => ({
  algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
  ephemeralPublicKey: createDeviceKeyPair().publicKey,
  wrappedKey: encodeBase64(crypto.getRandomValues(new Uint8Array(48))),
});

const seedEpoch = async ({
  epochNumber,
  recipients,
  targetGroupId,
}: {
  epochNumber: number;
  recipients: Array<ReturnType<typeof account>>;
  targetGroupId: string;
}) => {
  const id = `${targetGroupId}-epoch-${epochNumber}`;
  await prisma.groupEpoch.create({
    data: {
      id,
      groupId: targetGroupId,
      epochNumber,
      createdByDeviceId: owner.deviceId,
      senderPublicKey: owner.key.publicKey,
      recipientKeys: {
        create: recipients.map(({ deviceId }) => ({ ...fakeWrap(), recipientDeviceId: deviceId })),
      },
      historyWraps: {
        create: recipients.map(({ historyKeyId }) => ({
          ...fakeWrap(),
          historyKeyId,
          senderDeviceId: owner.deviceId,
          senderPublicKey: owner.key.publicKey,
        })),
      },
    },
  });
  return id;
};

const buildRotation = ({
  creator,
  historyRecipients,
  previousEpoch,
  recipients,
}: {
  creator: ReturnType<typeof account>;
  historyRecipients: HistoryPublicKey[];
  previousEpoch: GroupEpoch;
  recipients: RecipientPublicKeyMaterial[];
}) => {
  const next = createNextGroupEpoch({
    creator: { deviceId: creator.deviceId, privateKey: creator.key.privateKey },
    previousEpoch,
    recipients,
  });
  const wrapHistory = (historyKey: HistoryPublicKey) =>
    wrapEpochKeyForHistoryKey({
      epochId: next.epoch.epochId,
      epochKey: next.epochKey,
      historyKey,
      senderPrivateKey: creator.key.privateKey,
    });
  return {
    bundle: {
      createdByDeviceId: creator.deviceId,
      epochId: next.epoch.epochId,
      epochNumber: next.epoch.epochNumber,
      historyKeys: historyRecipients.map(wrapHistory),
      recipientKeys: next.wrappedKeys,
    },
    epochKey: next.epochKey,
    next,
    wrapHistory,
  };
};

const rotationContextFor = async (target: ReturnType<typeof account>, targetGroupId: string) => {
  await prisma.group.update({
    where: { id: targetGroupId },
    data: { epochRotationRequired: true },
  });
  const context = await api(target).groupEpoch.rotationContext({ groupId: targetGroupId });
  if (!context?.latestEpoch) throw new Error("Missing rotation context");
  return { ...context, latestEpoch: context.latestEpoch };
};

const sealGeometry = ({
  epochId,
  epochKey,
  geometry,
  senderDeviceId,
}: {
  epochId: string;
  epochKey: EpochKeyMaterial;
  geometry: PlaceGeometryV1;
  senderDeviceId: string;
}) => {
  const encrypted = encryptGroupPayload({
    epochId,
    epochKey,
    groupId: placesGroupId,
    kind: PLACE_GEOMETRY_KIND,
    payload: encodePlaceGeometryV1(geometry),
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

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "adversarial key distribution",
  () => {
    let epochOneId = "";
    let epochTwoId = "";

    beforeAll(async () => {
      await prisma.user.createMany({
        data: accounts.map(({ userId }) => ({
          id: userId,
          name: userId,
          email: `${userId}@example.test`,
        })),
      });
      await prisma.userDevice.createMany({
        data: [
          ...accounts.map(({ deviceId, key, userId }) => ({
            activatedAt: new Date(),
            icon: "phone" as const,
            id: deviceId,
            name: "Phone",
            publicKey: key.publicKey,
            publicKeyAlgorithm: "X25519",
            userId,
          })),
          {
            icon: "phone" as const,
            id: victimPending.deviceId,
            name: "Pending",
            publicKey: victimPending.key.publicKey,
            publicKeyAlgorithm: "X25519",
            userId: victim.userId,
          },
          {
            activatedAt: new Date(),
            icon: "phone" as const,
            id: victimRevoked.deviceId,
            name: "Removed",
            publicKey: victimRevoked.key.publicKey,
            publicKeyAlgorithm: "X25519",
            revokedAt: new Date(),
            userId: victim.userId,
          },
        ],
      });
      await prisma.accountHistoryKey.createMany({
        data: accounts.map(({ history, historyKeyId, userId }) => ({
          algorithm: history.algorithm,
          id: historyKeyId,
          publicKey: history.publicKey,
          userId,
          version: 1,
        })),
      });
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Family",
          groupMembers: {
            create: [
              { userId: owner.userId, role: "OWNER", joinedEpochNumber: 1 },
              { userId: member.userId, role: "MEMBER", joinedEpochNumber: 2 },
              { userId: victim.userId, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
        },
      });
      await prisma.group.create({
        data: {
          id: placesGroupId,
          name: "Places",
          groupMembers: {
            create: [
              { userId: owner.userId, role: "OWNER", joinedEpochNumber: 1 },
              { userId: member.userId, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
        },
      });
      epochOneId = await seedEpoch({
        epochNumber: 1,
        recipients: [owner, member, victim],
        targetGroupId: groupId,
      });
      epochTwoId = await seedEpoch({
        epochNumber: 2,
        recipients: [owner, member, victim],
        targetGroupId: groupId,
      });
      await prisma.groupEpochHistoryWrap.deleteMany({
        where: { groupEpochId: epochOneId, historyKeyId: member.historyKeyId },
      });
      await seedEpoch({
        epochNumber: 1,
        recipients: [owner, member],
        targetGroupId: placesGroupId,
      });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { in: [groupId, placesGroupId] } } });
      await prisma.user.deleteMany({ where: { id: { in: accounts.map(({ userId }) => userId) } } });
      await prisma.$disconnect();
    });

    test("recipient lists hold only active, non-removed devices of current members", async () => {
      const expected = [owner.deviceId, member.deviceId, victim.deviceId].sort();
      const listed = await api(member).groupEpoch.listRecipientPublicKeys({ groupId });
      expect(listed.map(({ id }) => id).sort()).toEqual(expected);
      const context = await rotationContextFor(member, groupId);
      expect(context.recipients.map(({ deviceId }) => deviceId).sort()).toEqual(expected);
      expect(context.historyRecipients.map(({ userId }) => userId).sort()).toEqual(
        [owner.userId, member.userId, victim.userId].sort(),
      );
      await expect(
        api(outsider).groupEpoch.listRecipientPublicKeys({ groupId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    test("a Member's rotation cannot leave anyone out, add other devices or forge the epoch", async () => {
      const context = await rotationContextFor(member, groupId);
      const { bundle, next, wrapHistory } = buildRotation({
        creator: member,
        historyRecipients: context.historyRecipients,
        previousEpoch: context.latestEpoch,
        recipients: context.recipients,
      });
      const extraRecipient = (deviceId: string, publicKey: string, userId: string) =>
        createNextGroupEpoch({
          creator: { deviceId: member.deviceId, privateKey: member.key.privateKey },
          previousEpoch: context.latestEpoch,
          recipients: [
            {
              algorithm: "X25519",
              createdAt: new Date().toISOString(),
              deviceId,
              publicKey,
              revokedAt: null,
              userId,
            },
          ],
        }).wrappedKeys.map((wrap) => ({ ...wrap, epochId: bundle.epochId }));
      const attempts = [
        {
          ...bundle,
          recipientKeys: bundle.recipientKeys.filter(
            ({ recipientDeviceId }) => recipientDeviceId !== victim.deviceId,
          ),
        },
        {
          ...bundle,
          recipientKeys: [
            ...bundle.recipientKeys,
            ...extraRecipient(victimPending.deviceId, victimPending.key.publicKey, victim.userId),
          ],
        },
        {
          ...bundle,
          recipientKeys: [
            ...bundle.recipientKeys,
            ...extraRecipient(victimRevoked.deviceId, victimRevoked.key.publicKey, victim.userId),
          ],
        },
        {
          ...bundle,
          recipientKeys: [
            ...bundle.recipientKeys,
            ...extraRecipient(outsider.deviceId, outsider.key.publicKey, outsider.userId),
          ],
        },
        {
          ...bundle,
          recipientKeys: bundle.recipientKeys.map((wrap) =>
            wrap.recipientDeviceId === victim.deviceId
              ? { ...wrap, recipientDeviceId: outsider.deviceId }
              : wrap,
          ),
        },
        {
          ...bundle,
          historyKeys: bundle.historyKeys.filter(({ userId }) => userId !== victim.userId),
        },
        {
          ...bundle,
          historyKeys: [
            ...bundle.historyKeys,
            wrapHistory({
              historyKeyId: outsider.historyKeyId,
              publicKey: outsider.history.publicKey,
              userId: outsider.userId,
              version: 1,
            }),
          ],
        },
        { ...bundle, epochNumber: context.latestEpoch.epochNumber },
        { ...bundle, epochNumber: context.latestEpoch.epochNumber + 2 },
      ];
      for (const nextEpoch of attempts) {
        await expect(api(member).groupEpoch.rotate({ groupId, nextEpoch })).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      }
      await expect(
        api(member).groupEpoch.rotate({
          groupId,
          nextEpoch: { ...bundle, createdByDeviceId: owner.deviceId },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        api(outsider).groupEpoch.rotate({ groupId, nextEpoch: bundle }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await prisma.groupEpoch.count({ where: { groupId } })).toBe(2);
      expect(next.epoch.epochNumber).toBe(3);

      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: false } });
      expect(await api(member).groupEpoch.rotate({ groupId, nextEpoch: bundle })).toEqual({
        rotated: false,
      });
      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: true } });
      expect(await api(member).groupEpoch.rotate({ groupId, nextEpoch: bundle })).toEqual({
        rotated: true,
      });
      const stored = await prisma.groupEpochRecipientKey.findMany({
        where: { groupEpochId: bundle.epochId },
        select: { recipientDeviceId: true },
      });
      expect(stored.map(({ recipientDeviceId }) => recipientDeviceId).sort()).toEqual(
        [owner.deviceId, member.deviceId, victim.deviceId].sort(),
      );
    });

    test("device keys can't be registered over another account's device or an existing key", async () => {
      const registerAs = (userId: string, deviceId: string, publicKey: string) =>
        caller(userId, null, `${userId}-${crypto.randomUUID()}`).auth.registerDeviceKey({
          algorithm: "X25519",
          deviceId,
          expectedUserId: userId,
          publicKey,
        });
      await expect(
        registerAs(outsider.userId, victim.deviceId, outsider.key.publicKey),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        registerAs(victim.userId, victim.deviceId, createDeviceKeyPair().publicKey),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        registerAs(victim.userId, victimRevoked.deviceId, victimRevoked.key.publicKey),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      const relinked = await registerAs(victim.userId, victim.deviceId, victim.key.publicKey);
      expect(relinked).toMatchObject({ id: victim.deviceId, sessionLinked: false });
      expect(
        await prisma.userDevice.findUniqueOrThrow({ where: { id: victim.deviceId } }),
      ).toMatchObject({ publicKey: victim.key.publicKey, userId: victim.userId });

      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: false } });
      const fresh = await registerAs(
        victim.userId,
        `${prefix}-victim-new`,
        createDeviceKeyPair().publicKey,
      );
      expect(fresh.activatedAt).toBeNull();
      expect(
        (await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).epochRotationRequired,
      ).toBe(false);
      const listed = await api(member).groupEpoch.listRecipientPublicKeys({ groupId });
      expect(listed.map(({ id }) => id)).not.toContain(fresh.id);
    });

    test("an existing History key can't be replaced through accountHistory.create", async () => {
      await expect(
        api(victim).accountHistory.create({
          algorithm: "X25519",
          id: crypto.randomUUID(),
          publicKey: createHistoryKeyPair().publicKey,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const keys = await prisma.accountHistoryKey.findMany({ where: { userId: victim.userId } });
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatchObject({
        id: victim.historyKeyId,
        publicKey: victim.history.publicKey,
      });
    });

    test("History wraps can't target others, reach before joining or overwrite a stored wrap", async () => {
      const wrap = (epochId: string, userId = member.userId) => ({
        ...fakeWrap(),
        epochId,
        historyKeyVersion: 1,
        senderPublicKey: member.key.publicKey,
        userId,
      });
      const add = (wraps: ReturnType<typeof wrap>[], deviceId = member.deviceId) =>
        api(member).groupEpoch.addHistoryWraps({
          deviceId,
          groupId,
          historyKeyId: member.historyKeyId,
          wraps,
        });
      await expect(add([wrap(epochTwoId, victim.userId)])).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await expect(add([wrap(epochOneId)])).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(add([wrap(epochTwoId)], victim.deviceId)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        api(member).groupEpoch.addHistoryWraps({
          deviceId: member.deviceId,
          groupId,
          historyKeyId: victim.historyKeyId,
          wraps: [wrap(epochTwoId)],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      const before = await prisma.groupEpochHistoryWrap.findUniqueOrThrow({
        where: {
          groupEpochId_historyKeyId: {
            groupEpochId: epochTwoId,
            historyKeyId: member.historyKeyId,
          },
        },
      });
      expect(await add([wrap(epochTwoId)])).toEqual({ added: 0 });
      expect(
        await prisma.groupEpochHistoryWrap.findUniqueOrThrow({
          where: {
            groupEpochId_historyKeyId: {
              groupEpochId: epochTwoId,
              historyKeyId: member.historyKeyId,
            },
          },
        }),
      ).toMatchObject({ wrappedKey: before.wrappedKey, senderPublicKey: before.senderPublicKey });
      expect(
        await prisma.groupEpochHistoryWrap.count({
          where: { groupEpochId: epochOneId, historyKeyId: member.historyKeyId },
        }),
      ).toBe(0);
    });

    test.skip("ADV-KD-1 (open bug): a Member can move an admin's place by re-encrypting it with a different geometry — should keep the geometry", async () => {
      const home = { v: 1, latitude: 51.5074, longitude: -0.1278, radiusMeters: 150 };
      const elsewhere = { v: 1, latitude: 48.8566, longitude: 2.3522, radiusMeters: 1000 };
      const firstEpochKey = generateGroupEpochKey();
      const { place } = await api(owner).groupPlaces.create({
        groupId: placesGroupId,
        name: "Home",
        emoji: "🏠",
        geometry: sealGeometry({
          epochId: `${placesGroupId}-epoch-1`,
          epochKey: firstEpochKey,
          geometry: home,
          senderDeviceId: owner.deviceId,
        }),
      });
      await expect(
        api(member).groupPlaces.update({
          groupId: placesGroupId,
          placeId: place.id,
          name: "Home",
          emoji: "🏠",
          expectedCiphertext: place.ciphertext,
          geometry: sealGeometry({
            epochId: `${placesGroupId}-epoch-1`,
            epochKey: firstEpochKey,
            geometry: elsewhere,
            senderDeviceId: member.deviceId,
          }),
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const secondPhone = { deviceId: `${prefix}-member-second`, key: createDeviceKeyPair() };
      await caller(member.userId, null, `${member.userId}-second-session`).auth.registerDeviceKey({
        algorithm: "X25519",
        deviceId: secondPhone.deviceId,
        expectedUserId: member.userId,
        publicKey: secondPhone.key.publicKey,
      });
      const { linkId } = await caller(
        member.userId,
        secondPhone.deviceId,
        `${member.userId}-second-session`,
      ).deviceLink.create();
      await api(member).deviceLink.approve({
        linkId,
        enc: createDeviceKeyPair().publicKey,
        ciphertext: encodeBase64(crypto.getRandomValues(new Uint8Array(64))),
      });
      const context = await api(member).groupEpoch.rotationContext({ groupId: placesGroupId });
      if (!context?.latestEpoch)
        throw new Error("The Member's own phone link didn't flag rotation");
      const { bundle, epochKey } = buildRotation({
        creator: member,
        historyRecipients: context.historyRecipients,
        previousEpoch: context.latestEpoch,
        recipients: context.recipients,
      });
      await api(member).groupEpoch.rotate({ groupId: placesGroupId, nextEpoch: bundle });

      await api(member)
        .groupPlaces.reEncrypt({
          groupId: placesGroupId,
          places: [
            {
              placeId: place.id,
              name: place.name,
              emoji: place.emoji,
              expectedCiphertext: place.ciphertext,
              geometry: sealGeometry({
                epochId: bundle.epochId,
                epochKey,
                geometry: elsewhere,
                senderDeviceId: member.deviceId,
              }),
            },
          ],
        })
        .catch(() => null);

      const stored = await prisma.place.findUniqueOrThrow({ where: { id: place.id } });
      const decrypted = decryptGroupPayload({
        encryptedPayload: { ...stored, groupId: placesGroupId, kind: PLACE_GEOMETRY_KIND },
        epochKey: stored.epochId === bundle.epochId ? epochKey : firstEpochKey,
        expectedMetadata: {
          epochId: stored.epochId,
          groupId: placesGroupId,
          kind: PLACE_GEOMETRY_KIND,
          senderDeviceId: stored.senderDeviceId,
        },
      });
      expect(validatePlaceGeometryV1(decodeJsonPayload(decrypted.bytes))).toEqual(home);
    });
  },
);
