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
  type PlaceGeometryV1,
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
const creator = `${prefix}-creator`;
const users = [owner, admin, member, outsider];
const groupId = `${prefix}-group`;
const otherGroupId = `${prefix}-other-group`;
const oldEpochId = `${prefix}-epoch-1`;
const latestEpochId = `${prefix}-epoch-2`;
const otherEpochId = `${prefix}-other-epoch`;
const epochKey = generateGroupEpochKey();
const home = {
  v: 1,
  latitude: 51.5074,
  longitude: -0.1278,
  radiusMeters: 150,
} satisfies PlaceGeometryV1;

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
  geometry?: PlaceGeometryV1;
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

const seedPlace = ({
  id,
  epochId = latestEpochId,
  name = "Home",
  emoji = "🏠",
  targetGroupId = groupId,
  createdByUserId = owner,
  updatedByUserId,
}: {
  id: string;
  epochId?: string;
  name?: string;
  emoji?: string;
  targetGroupId?: string;
  createdByUserId?: string;
  updatedByUserId?: string;
}) => {
  const geometry = sealGeometry({ epochId, senderDeviceId: deviceOf(owner), targetGroupId });
  return prisma.place.create({
    data: {
      id,
      groupId: targetGroupId,
      name,
      emoji,
      epochId,
      senderDeviceId: geometry.senderDeviceId,
      algorithm: geometry.algorithm,
      nonce: geometry.nonce,
      ciphertext: geometry.ciphertext,
      createdByUserId,
      updatedByUserId: updatedByUserId ?? null,
    },
  });
};

const reEncryptRequest = (place: {
  id: string;
  name: string;
  emoji: string;
  ciphertext: string;
}) => ({
  placeId: place.id,
  name: place.name,
  emoji: place.emoji,
  expectedCiphertext: place.ciphertext,
  geometry: sealGeometry({ senderDeviceId: deviceOf(member) }),
});

const revision = async (targetGroupId = groupId) =>
  (await prisma.group.findUniqueOrThrow({ where: { id: targetGroupId } })).placesRevision;

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "group places with PostgreSQL",
  () => {
    beforeEach(async () => {
      now += 60_000;
      await prisma.place.deleteMany({ where: { groupId: { in: [groupId, otherGroupId] } } });
      await prisma.group.updateMany({
        where: { id: { in: [groupId, otherGroupId] } },
        data: { epochRotationRequired: false },
      });
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
      await prisma.user.deleteMany({ where: { id: { in: [...users, creator] } } });
      await prisma.$disconnect();
    });

    test("members list places, admins manage them, and others are refused", async () => {
      const start = new Date();
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
      expect(
        await prisma.groupEvent.findMany({
          where: { groupId, createdAt: { gte: start } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { type: true, actorUserId: true, name: true, previousName: true, emoji: true },
        }),
      ).toEqual([
        { type: "PLACE_ADDED", actorUserId: admin, name: "Home", previousName: null, emoji: "🏠" },
        {
          type: "PLACE_UPDATED",
          actorUserId: owner,
          name: "Grandma's",
          previousName: "Home",
          emoji: "👵",
        },
        {
          type: "PLACE_DELETED",
          actorUserId: admin,
          name: "Grandma's",
          previousName: null,
          emoji: "👵",
        },
      ]);
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

    test("geometry writes need the group's latest epoch and the caller's own device", async () => {
      const old = await seedPlace({ id: `${prefix}-old`, epochId: oldEpochId });
      const save = (epochId: string, senderDeviceId = deviceOf(owner)) => ({
        create: () =>
          caller(owner).groupPlaces.create({
            groupId,
            name: "Home",
            emoji: "🏠",
            geometry: sealGeometry({ epochId, senderDeviceId }),
          }),
        update: () =>
          caller(owner).groupPlaces.update({
            groupId,
            placeId: old.id,
            name: "Home",
            emoji: "🏠",
            geometry: sealGeometry({ epochId, senderDeviceId }),
            expectedCiphertext: old.ciphertext,
          }),
      });

      for (const epochId of [oldEpochId, `${prefix}-missing`]) {
        const { create, update } = save(epochId);
        await expect(create()).rejects.toMatchObject({ cause: { reason: "EPOCH_NOT_LATEST" } });
        await expect(update()).rejects.toMatchObject({ cause: { reason: "EPOCH_NOT_LATEST" } });
      }
      const otherGroup = save(otherEpochId);
      await expect(otherGroup.create()).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Epoch does not belong to this group.",
      });
      await expect(otherGroup.update()).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Epoch does not belong to this group.",
      });
      const otherDevice = save(latestEpochId, deviceOf(admin));
      await expect(otherDevice.create()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(otherDevice.update()).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(await prisma.place.findMany({ where: { groupId } })).toEqual([old]);
    });

    test("geometry writes wait for a pending key rotation, but deletes go ahead", async () => {
      const old = await seedPlace({ id: `${prefix}-old`, epochId: oldEpochId });
      const current = await seedPlace({ id: `${prefix}-current` });
      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: true } });
      const pending = { cause: { reason: "EPOCH_ROTATION_PENDING" } };

      await expect(createPlace(owner)).rejects.toMatchObject(pending);
      await expect(
        caller(owner).groupPlaces.update({
          groupId,
          placeId: current.id,
          name: "Moved",
          emoji: "🏠",
          geometry: sealGeometry({ senderDeviceId: deviceOf(owner) }),
          expectedCiphertext: current.ciphertext,
        }),
      ).rejects.toMatchObject(pending);
      await expect(
        caller(member).groupPlaces.reEncrypt({ groupId, places: [reEncryptRequest(old)] }),
      ).rejects.toMatchObject(pending);
      expect(await prisma.place.findMany({ where: { groupId }, orderBy: { id: "asc" } })).toEqual([
        current,
        old,
      ]);

      await caller(admin).groupPlaces.delete({ groupId, placeId: current.id });
      expect(await prisma.place.findMany({ where: { groupId } })).toEqual([old]);
    });

    test("any member can re-encrypt old places to the latest epoch in one batch", async () => {
      const school = await seedPlace({
        id: `${prefix}-a`,
        epochId: oldEpochId,
        name: "School",
        emoji: "🏫",
        updatedByUserId: admin,
      });
      const gym = await seedPlace({ id: `${prefix}-b`, epochId: oldEpochId, name: "Gym" });
      const renamed = await seedPlace({ id: `${prefix}-c`, epochId: oldEpochId });
      const newEmoji = await seedPlace({ id: `${prefix}-d`, epochId: oldEpochId });
      const edited = await seedPlace({ id: `${prefix}-e`, epochId: oldEpochId });
      const upToDate = await seedPlace({ id: `${prefix}-f` });
      const before = await revision();

      const result = await caller(member).groupPlaces.reEncrypt({
        groupId,
        places: [
          reEncryptRequest(upToDate),
          { ...reEncryptRequest(edited), expectedCiphertext: "stale" },
          { ...reEncryptRequest(newEmoji), emoji: "🏡" },
          { ...reEncryptRequest(renamed), name: "Old home" },
          { ...reEncryptRequest(school), placeId: `${prefix}-g-missing` },
          reEncryptRequest(gym),
          reEncryptRequest(school),
        ],
      });

      expect(result).toMatchObject({
        places: [
          {
            id: school.id,
            name: "School",
            emoji: "🏫",
            epochId: latestEpochId,
            senderDeviceId: deviceOf(member),
            kind: PLACE_GEOMETRY_KIND,
            createdByUserId: owner,
            updatedByUserId: admin,
          },
          { id: gym.id, name: "Gym", epochId: latestEpochId, updatedByUserId: null },
        ],
        skipped: [upToDate.id],
        changed: [renamed.id, newEmoji.id, edited.id],
        gone: [`${prefix}-g-missing`],
        placesRevision: before + 1,
      });
      expect(await revision()).toBe(before + 1);
      const stored = await prisma.place.findMany({ where: { groupId }, orderBy: { id: "asc" } });
      expect(stored.slice(2)).toEqual([renamed, newEmoji, edited, upToDate]);

      const nothingToDo = await caller(member).groupPlaces.reEncrypt({
        groupId,
        places: [reEncryptRequest(upToDate), { ...reEncryptRequest(renamed), name: "Old home" }],
      });
      expect(nothingToDo).toEqual({
        places: [],
        skipped: [upToDate.id],
        changed: [renamed.id],
        gone: [],
        placesRevision: before + 1,
      });
      expect(await revision()).toBe(before + 1);
    });

    test("re-encrypting refuses any geometry that isn't on the latest epoch", async () => {
      const school = await seedPlace({ id: `${prefix}-a`, epochId: oldEpochId });
      const gym = await seedPlace({ id: `${prefix}-b`, epochId: oldEpochId });
      const before = await revision();
      await expect(
        caller(member).groupPlaces.reEncrypt({
          groupId,
          places: [
            reEncryptRequest(school),
            {
              ...reEncryptRequest(gym),
              geometry: sealGeometry({ epochId: oldEpochId, senderDeviceId: deviceOf(member) }),
            },
          ],
        }),
      ).rejects.toMatchObject({ cause: { reason: "EPOCH_NOT_LATEST" } });
      expect(await prisma.place.findMany({ where: { groupId }, orderBy: { id: "asc" } })).toEqual([
        school,
        gym,
      ]);
      expect(await revision()).toBe(before);
    });

    test("a place from another group is never touched through this group", async () => {
      const foreign = await seedPlace({
        id: `${prefix}-foreign`,
        epochId: otherEpochId,
        targetGroupId: otherGroupId,
        createdByUserId: outsider,
      });
      await expect(
        caller(owner).groupPlaces.update({
          groupId,
          placeId: foreign.id,
          name: "Taken",
          emoji: "🏠",
          geometry: sealGeometry({ senderDeviceId: deviceOf(owner) }),
          expectedCiphertext: foreign.ciphertext,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        caller(owner).groupPlaces.delete({ groupId, placeId: foreign.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        caller(member).groupPlaces.reEncrypt({ groupId, places: [reEncryptRequest(foreign)] }),
      ).resolves.toMatchObject({ places: [], gone: [foreign.id] });
      expect(await prisma.place.findUniqueOrThrow({ where: { id: foreign.id } })).toEqual(foreign);
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

      const editedElsewhere = await seedPlace({
        id: `${prefix}-edited-elsewhere`,
        epochId: otherEpochId,
        targetGroupId: otherGroupId,
        createdByUserId: outsider,
        updatedByUserId: creator,
      });
      const before = await revision();
      const otherBefore = await revision(otherGroupId);
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
      expect(await prisma.place.findUniqueOrThrow({ where: { id: editedElsewhere.id } })).toEqual({
        ...editedElsewhere,
        updatedByUserId: null,
      });
      expect(await revision(otherGroupId)).toBe(otherBefore + 1);
    });
  },
);
