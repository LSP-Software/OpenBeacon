import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  decodeJsonPayload,
  decryptGroupPayload,
  encodePlaceGeometryV1,
  encryptGroupPayload,
  generateGroupEpochKey,
  PLACE_GEOMETRY_KIND,
  validatePlaceGeometryV1,
} from "@openbeacon/encryption";
import { MAX_PLACES_PER_GROUP } from "@openbeacon/schemas";
import { deleteAccountRecords } from "../../lib/account-deletion.ts";
import { holdRowLock } from "../../lib/databaseLocks.testUtil.ts";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { removeGroupMemberWithOwnerGuard } from "./assertGroupMemberCanBeRemoved.ts";
import { groupPlacesRouter } from "./groupPlacesRouter.ts";

const router = createTRPCRouter({ groupPlaces: groupPlacesRouter });
let now = 0;
const cache = createIntegrationTestCache(() => now);
const prefix = `places-${crypto.randomUUID()}`;
const owner = `${prefix}-owner`;
const admin = `${prefix}-admin`;
const member = `${prefix}-member`;
const outsider = `${prefix}-outsider`;
const users = [owner, admin, member, outsider];
const groupId = `${prefix}-group`;
const otherGroupId = `${prefix}-other-group`;
const oldEpochId = `${prefix}-epoch-1`;
const latestEpochId = `${prefix}-epoch-2`;
const otherEpochId = `${prefix}-other-epoch`;
const epochKey = generateGroupEpochKey();
const home = { v: 1, latitude: 51.5074, longitude: -0.1278, radiusMeters: 150 } as const;

const deviceOf = (userId: string) => `${userId}-device`;

const caller = (userId: string) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId: deviceOf(userId),
      unverifiedDeviceId: null,
      session: { user: { id: userId } },
    }) as Parameters<typeof router.createCaller>[0],
  );

const sealGeometry = ({
  epochId = latestEpochId,
  geometry = home,
  senderDeviceId,
  targetGroupId = groupId,
}: {
  epochId?: string;
  geometry?: { v: 1; latitude: number; longitude: number; radiusMeters: number };
  senderDeviceId: string;
  targetGroupId?: string;
}) => {
  const encrypted = encryptGroupPayload({
    epochId,
    epochKey,
    groupId: targetGroupId,
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

const createPlace = (userId: string, name = "Home", targetGroupId = groupId) =>
  caller(userId).groupPlaces.create({
    groupId: targetGroupId,
    name,
    emoji: "🏠",
    geometry: sealGeometry({ senderDeviceId: deviceOf(userId), targetGroupId }),
  });

const revision = async () =>
  (await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).placesRevision;

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "group places with PostgreSQL",
  () => {
    beforeEach(async () => {
      now += 60_000;
      await prisma.place.deleteMany({ where: { groupId: { in: [groupId, otherGroupId] } } });
    });

    beforeAll(async () => {
      await prisma.user.createMany({
        data: users.map((id) => ({ id, name: id, email: `${id}@example.test` })),
      });
      await prisma.userDevice.createMany({
        data: users.map((userId) => ({
          activatedAt: new Date(),
          icon: "phone" as const,
          id: deviceOf(userId),
          name: "Phone",
          publicKey: "public-key",
          publicKeyAlgorithm: "X25519",
          userId,
        })),
      });
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Family",
          groupMembers: {
            create: [
              { userId: owner, role: "OWNER", joinedEpochNumber: 1 },
              { userId: admin, role: "ADMIN", joinedEpochNumber: 1 },
              { userId: member, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
          groupEpochs: {
            create: [
              { id: oldEpochId, epochNumber: 1, senderPublicKey: "public-key" },
              { id: latestEpochId, epochNumber: 2, senderPublicKey: "public-key" },
            ],
          },
        },
      });
      await prisma.group.create({
        data: {
          id: otherGroupId,
          name: "Other",
          groupMembers: { create: [{ userId: outsider, role: "OWNER", joinedEpochNumber: 1 }] },
          groupEpochs: {
            create: [{ id: otherEpochId, epochNumber: 1, senderPublicKey: "public-key" }],
          },
        },
      });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { in: [groupId, otherGroupId] } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    test("members list places, admins manage them, and others are refused", async () => {
      const before = await revision();
      const { place, placesRevision } = await createPlace(admin);
      expect(placesRevision).toBe(before + 1);

      const listed = await caller(member).groupPlaces.list({ groupId });
      expect(listed).toMatchObject({
        latestEpochId,
        placesRevision: before + 1,
        places: [
          {
            id: place.id,
            name: "Home",
            emoji: "🏠",
            epochId: latestEpochId,
            kind: PLACE_GEOMETRY_KIND,
            createdByUserId: admin,
            updatedByUserId: null,
          },
        ],
      });

      await expect(caller(outsider).groupPlaces.list({ groupId })).rejects.toThrow(
        "You are not a member of this group",
      );
      await expect(createPlace(member)).rejects.toThrow("You are not an admin of this group");
      await expect(createPlace(outsider)).rejects.toThrow("You are not a member of this group");
      await expect(
        caller(member).groupPlaces.update({
          groupId,
          placeId: place.id,
          name: "Not home",
          emoji: "🏠",
          geometry: sealGeometry({ senderDeviceId: deviceOf(member) }),
          expectedCiphertext: place.ciphertext,
        }),
      ).rejects.toThrow("You are not an admin of this group");
      await expect(
        caller(member).groupPlaces.delete({ groupId, placeId: place.id }),
      ).rejects.toThrow("You are not an admin of this group");

      const updated = await caller(owner).groupPlaces.update({
        groupId,
        placeId: place.id,
        name: "Grandma's",
        emoji: "👵",
        geometry: sealGeometry({ senderDeviceId: deviceOf(owner) }),
        expectedCiphertext: place.ciphertext,
      });
      expect(updated.place).toMatchObject({
        name: "Grandma's",
        emoji: "👵",
        updatedByUserId: owner,
      });
      expect(updated.placesRevision).toBe(before + 2);

      await expect(
        caller(admin).groupPlaces.delete({ groupId, placeId: place.id }),
      ).resolves.toEqual({ placesRevision: before + 3 });
      expect(await caller(member).groupPlaces.list({ groupId })).toMatchObject({ places: [] });
      await expect(
        caller(admin).groupPlaces.delete({ groupId, placeId: place.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("stores the geometry only as ciphertext that the group key opens", async () => {
      const { place } = await createPlace(owner);
      const [row] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM "Place" WHERE id = ${place.id}
    `;
      const stored = JSON.stringify(row);
      for (const plain of ["51.5074", "-0.1278", "radiusMeters", "latitude"]) {
        expect(stored).not.toContain(plain);
      }
      const decrypted = decryptGroupPayload({
        encryptedPayload: { ...place, groupId },
        epochKey,
        expectedMetadata: {
          epochId: place.epochId,
          groupId,
          kind: PLACE_GEOMETRY_KIND,
          senderDeviceId: place.senderDeviceId,
        },
      });
      expect(validatePlaceGeometryV1(decodeJsonPayload(decrypted.bytes))).toEqual(home);
    });

    test("a stale expectedCiphertext is rejected and the place keeps the newer edit", async () => {
      const { place } = await createPlace(owner);
      const first = await caller(admin).groupPlaces.update({
        groupId,
        placeId: place.id,
        name: "Home",
        emoji: "🏡",
        geometry: sealGeometry({ senderDeviceId: deviceOf(admin) }),
        expectedCiphertext: place.ciphertext,
      });
      const revisionAfterFirst = await revision();

      await expect(
        caller(owner).groupPlaces.update({
          groupId,
          placeId: place.id,
          name: "Old home",
          emoji: "🏠",
          geometry: sealGeometry({ senderDeviceId: deviceOf(owner) }),
          expectedCiphertext: place.ciphertext,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT", cause: { reason: "PLACE_CHANGED" } });
      expect(await prisma.place.findUniqueOrThrow({ where: { id: place.id } })).toMatchObject({
        emoji: "🏡",
        ciphertext: first.place.ciphertext,
      });
      expect(await revision()).toBe(revisionAfterFirst);
    });

    test("any member can re-encrypt to the latest epoch, without changing the name or emoji", async () => {
      const created = await caller(owner).groupPlaces.create({
        groupId,
        name: "School",
        emoji: "🏫",
        geometry: sealGeometry({ epochId: oldEpochId, senderDeviceId: deviceOf(owner) }),
      });
      expect(created.place.epochId).toBe(oldEpochId);
      const reEncrypt = (
        overrides: Partial<{ epochId: string; name: string; emoji: string; expected: string }>,
      ) =>
        caller(member).groupPlaces.reEncrypt({
          groupId,
          placeId: created.place.id,
          name: overrides.name ?? "School",
          emoji: overrides.emoji ?? "🏫",
          geometry: sealGeometry({
            epochId: overrides.epochId ?? latestEpochId,
            senderDeviceId: deviceOf(member),
          }),
          expectedCiphertext: overrides.expected ?? created.place.ciphertext,
        });

      await expect(reEncrypt({ epochId: oldEpochId })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        cause: { reason: "EPOCH_NOT_LATEST" },
      });
      await expect(reEncrypt({ name: "Old school" })).rejects.toMatchObject({
        code: "CONFLICT",
        cause: { reason: "PLACE_CHANGED" },
      });
      await expect(reEncrypt({ emoji: "🎒" })).rejects.toMatchObject({ code: "CONFLICT" });

      const reEncrypted = await reEncrypt({});
      expect(reEncrypted.place).toMatchObject({
        name: "School",
        emoji: "🏫",
        epochId: latestEpochId,
        senderDeviceId: deviceOf(member),
        updatedByUserId: null,
      });
      await expect(reEncrypt({})).rejects.toMatchObject({ code: "CONFLICT" });
    });

    test("the sender device must be the caller's own and the epoch must be the group's", async () => {
      await expect(
        caller(owner).groupPlaces.create({
          groupId,
          name: "Home",
          emoji: "🏠",
          geometry: sealGeometry({ senderDeviceId: deviceOf(admin) }),
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller(owner).groupPlaces.create({
          groupId,
          name: "Home",
          emoji: "🏠",
          geometry: sealGeometry({ epochId: otherEpochId, senderDeviceId: deviceOf(owner) }),
        }),
      ).rejects.toThrow("Epoch does not belong to this group.");
      await expect(
        caller(owner).groupPlaces.create({
          groupId,
          name: "Home",
          emoji: "🏠",
          geometry: sealGeometry({ epochId: `${prefix}-missing`, senderDeviceId: deviceOf(owner) }),
        }),
      ).rejects.toThrow("Epoch does not belong to this group.");
      expect(await prisma.place.count({ where: { groupId } })).toBe(0);
    });

    test(`a group holds at most ${MAX_PLACES_PER_GROUP} places`, async () => {
      const geometry = sealGeometry({ senderDeviceId: deviceOf(owner) });
      await prisma.place.createMany({
        data: Array.from({ length: MAX_PLACES_PER_GROUP }, (_, index) => ({
          groupId,
          name: `Place ${index}`,
          emoji: "📍",
          epochId: latestEpochId,
          senderDeviceId: geometry.senderDeviceId,
          algorithm: geometry.algorithm,
          nonce: geometry.nonce,
          ciphertext: geometry.ciphertext,
          createdByUserId: owner,
        })),
      });
      await expect(createPlace(owner, "One too many")).rejects.toMatchObject({
        cause: { reason: "PLACE_LIMIT_REACHED" },
      });
      expect(await prisma.place.count({ where: { groupId } })).toBe(MAX_PLACES_PER_GROUP);
    });

    test("two admins saving the last free place at once can't go over the limit", async () => {
      const geometry = sealGeometry({ senderDeviceId: deviceOf(owner) });
      await prisma.place.createMany({
        data: Array.from({ length: MAX_PLACES_PER_GROUP - 1 }, (_, index) => ({
          groupId,
          name: `Place ${index}`,
          emoji: "📍",
          epochId: latestEpochId,
          senderDeviceId: geometry.senderDeviceId,
          algorithm: geometry.algorithm,
          nonce: geometry.nonce,
          ciphertext: geometry.ciphertext,
          createdByUserId: owner,
        })),
      });
      const before = await revision();
      const held = await holdRowLock({
        db: prisma,
        id: groupId,
        mode: "FOR NO KEY UPDATE",
        table: "Group",
      });
      const saves = Promise.allSettled([
        createPlace(owner, "Owner's"),
        createPlace(admin, "Admin's"),
      ]);
      await held.waitForWaiters(2);
      await held.release();
      const results = await saves;
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.find((result) => result.status === "rejected")).toMatchObject({
        reason: { cause: { reason: "PLACE_LIMIT_REACHED" } },
      });
      expect(await prisma.place.count({ where: { groupId } })).toBe(MAX_PLACES_PER_GROUP);
      expect(await revision()).toBe(before + 1);
    });

    test("removing the creator keeps their places, and deleting their account deletes them", async () => {
      const creator = `${prefix}-creator`;
      await prisma.user.create({
        data: {
          id: creator,
          name: creator,
          email: `${creator}@example.test`,
          devices: {
            create: {
              activatedAt: new Date(),
              icon: "phone",
              id: deviceOf(creator),
              name: "Phone",
              publicKey: "public-key",
              publicKeyAlgorithm: "X25519",
            },
          },
          groupMembers: { create: { groupId, role: "ADMIN", joinedEpochNumber: 2 } },
        },
      });
      const { place: kept } = await createPlace(owner, "Owner's place");
      const { place: created } = await createPlace(creator, "Creator's place");
      await caller(creator).groupPlaces.update({
        groupId,
        placeId: kept.id,
        name: "Edited by creator",
        emoji: "🏠",
        geometry: sealGeometry({ senderDeviceId: deviceOf(creator) }),
        expectedCiphertext: kept.ciphertext,
      });

      const creatorMember = await prisma.groupMember.findUniqueOrThrow({
        where: { userId_groupId: { userId: creator, groupId } },
      });
      await prisma.$transaction((tx) =>
        removeGroupMemberWithOwnerGuard({ db: tx, groupId, memberId: creatorMember.id }),
      );
      expect(
        (await caller(member).groupPlaces.list({ groupId })).places.map((place) => place.id),
      ).toEqual([kept.id, created.id]);

      const before = await revision();
      await expect(
        deleteAccountRecords({
          db: prisma,
          userId: creator,
          imageUrlPrefix: "https://cdn.example/bucket",
          mode: "immediate",
          securityAlerts: null,
        }),
      ).resolves.toBe(true);
      expect(await prisma.place.findMany({ where: { groupId } })).toMatchObject([
        { id: kept.id, name: "Edited by creator", createdByUserId: owner, updatedByUserId: null },
      ]);
      expect(await revision()).toBe(before + 1);
    });
  },
);
