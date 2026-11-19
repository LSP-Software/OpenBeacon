import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  encodePlaceGeometryV1,
  encryptGroupPayload,
  generateGroupEpochKey,
  PLACE_GEOMETRY_KIND,
} from "@openbeacon/encryption";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { accountRouter } from "../accountRouter.ts";
import { groupPlacesRouter } from "../group/groupPlacesRouter.ts";
import { groupSettingsRouter } from "../group/groupSettingsRouter.ts";
import { groupTrackingRouter } from "../group/groupTrackingRouter.ts";

const prefix = `adv-input-${crypto.randomUUID()}`;
const ownerId = `${prefix}-owner`;
const ownerDeviceId = `${ownerId}-device`;
const groupId = `${prefix}-group`;
const epochId = `${prefix}-epoch`;
const epochKey = generateGroupEpochKey();
const cache = createIntegrationTestCache(() => 0);
const router = createTRPCRouter({
  account: accountRouter,
  groupPlaces: groupPlacesRouter,
  groupSettings: groupSettingsRouter,
  groupTracking: groupTrackingRouter,
});

const owner = () =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId: ownerDeviceId,
      unverifiedDeviceId: null,
      session: { user: { id: ownerId }, session: { id: `${ownerId}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );

const geometry = () => {
  const encrypted = encryptGroupPayload({
    epochId,
    epochKey,
    groupId,
    kind: PLACE_GEOMETRY_KIND,
    payload: encodePlaceGeometryV1({ v: 1, latitude: 51.5, longitude: -0.12, radiusMeters: 150 }),
    senderDeviceId: ownerDeviceId,
  });
  return {
    algorithm: encrypted.algorithm,
    ciphertext: encrypted.ciphertext,
    epochId,
    kind: PLACE_GEOMETRY_KIND,
    nonce: encrypted.nonce,
    senderDeviceId: ownerDeviceId,
  };
};

const createPlace = (name: string, emoji = "🏠") =>
  owner().groupPlaces.create({ groupId, name, emoji, geometry: geometry() });

const spoofedNames = {
  "right-to-left override": "Family‮ylimaf",
  "zero-width space": "Fam​ily",
  "bell control character": "Fam\u0007ily",
  "line break": "Family\nAdmins: you",
};

const invisibleNames = {
  "Hangul filler": "ㅤ",
  "braille blank": "⠀⠀",
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "adversarial input abuse with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.create({
        data: { id: ownerId, name: "Owner", email: `${ownerId}@example.test` },
      });
      await prisma.userDevice.create({
        data: {
          id: ownerDeviceId,
          userId: ownerId,
          publicKey: createDeviceKeyPair().publicKey,
          publicKeyAlgorithm: "X25519",
          name: "Phone",
          icon: "phone",
          activatedAt: new Date(),
        },
      });
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Family",
          groupMembers: { create: { userId: ownerId, role: "OWNER", joinedEpochNumber: 1 } },
        },
      });
      await prisma.groupEpoch.create({
        data: {
          id: epochId,
          groupId,
          epochNumber: 1,
          createdByDeviceId: ownerDeviceId,
          senderPublicKey: createDeviceKeyPair().publicKey,
        },
      });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
      await prisma.$disconnect();
    });

    test("place names refuse direction overrides, invisible format and control characters", async () => {
      for (const name of Object.values(spoofedNames)) {
        await expect(createPlace(name)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
      await expect(createPlace("x".repeat(51))).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(createPlace("Home", "🏠🏠")).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(createPlace("Home", "a")).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(createPlace("Home", "👨‍👩‍👧‍👦".repeat(3))).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await expect(createPlace("Café \u{1F3E0}", "👨‍👩‍👧‍👦")).resolves.toMatchObject({
        place: { name: "Café \u{1F3E0}", emoji: "👨‍👩‍👧‍👦" },
      });
      expect(await prisma.place.count({ where: { groupId } })).toBe(1);
    });

    test.skip("ADV-IN-1 (open bug): group names that spoof direction or carry control characters should be refused", async () => {
      for (const name of Object.values(spoofedNames)) {
        await expect(owner().groupSettings.rename({ groupId, name })).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      }
      expect((await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).name).toBe(
        "Family",
      );
    });

    test("ADV-IN-1 probe: today a group can be renamed to a direction-override or multi-line name", async () => {
      await owner().groupSettings.rename({ groupId, name: spoofedNames["right-to-left override"] });
      await owner().groupSettings.rename({ groupId, name: spoofedNames["line break"] });
      expect((await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).name).toBe(
        spoofedNames["line break"],
      );
      await owner().groupSettings.rename({ groupId, name: "Family" });
    });

    test.skip("ADV-IN-2 (open bug): a NUL in a group name should be a BAD_REQUEST, not a database error", async () => {
      await expect(
        owner().groupSettings.rename({ groupId, name: "Fam\u0000ily" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    test.skip("ADV-IN-3 (open bug): account names should refuse direction overrides and zero-width characters", async () => {
      for (const name of [
        spoofedNames["right-to-left override"],
        spoofedNames["zero-width space"],
      ]) {
        await expect(owner().account.updateName({ name })).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      }
      expect((await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).name).toBe("Owner");
    });

    test("ADV-IN-3 probe: today an account name can carry a right-to-left override", async () => {
      await expect(
        owner().account.updateName({ name: spoofedNames["right-to-left override"] }),
      ).resolves.toEqual({ name: spoofedNames["right-to-left override"] });
      await prisma.user.update({ where: { id: ownerId }, data: { name: "Owner" } });
    });

    test.skip("ADV-IN-4 (open bug): place and device names made only of blank letters should be refused", async () => {
      for (const name of Object.values(invisibleNames)) {
        await expect(createPlace(name)).rejects.toMatchObject({ code: "BAD_REQUEST" });
        await expect(
          owner().account.updateDevice({ deviceId: ownerDeviceId, name }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
    });

    test.skip("ADV-IN-5 (open bug): a history cursor id past the bigint range should be a BAD_REQUEST, not a server error", async () => {
      const hour = Math.floor(Date.now() / 3_600_000);
      await expect(
        owner().groupTracking.historyRange({
          groupId,
          fromHour: hour - 2,
          toHour: hour,
          cursor: { capturedHour: hour - 1, streamId: "9999999999999999999", pointId: "1" },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    test.skip("ADV-IN-6 (open bug): a poll cursor date Postgres can't store should be a BAD_REQUEST, not a server error", async () => {
      await expect(
        owner().groupTracking.poll({
          groupId,
          cursor: { senderDeviceId: ownerDeviceId, updatedAt: new Date(-8.64e15) },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    test("ADV-IN-2/4/5/6 probe: blank names are stored and bad cursors reach Postgres as server errors", async () => {
      const blank = await createPlace(invisibleNames["Hangul filler"]);
      expect(blank.place.name).toBe(invisibleNames["Hangul filler"]);
      await prisma.place.delete({ where: { id: blank.place.id } });
      await owner().account.updateDevice({
        deviceId: ownerDeviceId,
        name: invisibleNames["braille blank"],
      });
      expect(
        (await prisma.userDevice.findUniqueOrThrow({ where: { id: ownerDeviceId } })).name,
      ).toBe(invisibleNames["braille blank"]);
      await prisma.userDevice.update({ where: { id: ownerDeviceId }, data: { name: "Phone" } });

      const hour = Math.floor(Date.now() / 3_600_000);
      const serverError = { code: "INTERNAL_SERVER_ERROR" };
      await expect(
        owner().groupSettings.rename({ groupId, name: "Fam\u0000ily" }),
      ).rejects.toMatchObject(serverError);
      await expect(
        owner().groupTracking.historyRange({
          groupId,
          fromHour: hour - 2,
          toHour: hour,
          cursor: { capturedHour: hour - 1, streamId: "9999999999999999999", pointId: "1" },
        }),
      ).rejects.toMatchObject(serverError);
      await expect(
        owner().groupTracking.poll({
          groupId,
          cursor: { senderDeviceId: ownerDeviceId, updatedAt: new Date(-8.64e15) },
        }),
      ).rejects.toMatchObject(serverError);
    });
  },
);
