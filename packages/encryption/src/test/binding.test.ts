import { describe, expect, test } from "bun:test";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  createInitialGroupEpoch,
  decodeTrackingPoint,
  decryptGroupPayload,
  decryptImage,
  decryptImageKey,
  encodePlaceGeometryV1,
  encodeTrackingPoint,
  type EncryptedPayload,
  encryptGroupPayload,
  encryptImage,
  encryptImageKey,
  generateImageKey,
  openPersonalData,
  openProfileImageKey,
  PLACE_GEOMETRY_KIND,
  type PersonalDataPurpose,
  sealPersonalDataForHistoryKey,
  sealProfileImageKey,
  serializeRecipientPublicKeyMaterial,
  TRACKING_POINT_KIND,
  unwrapEpochKey,
  unwrapHistoryEpochKey,
  wrapEpochKeyForHistoryKey,
} from "../index.ts";
import { openedVariants } from "./adversarial.ts";

const recipient = (deviceId: string, userId: string, publicKey: string) =>
  serializeRecipientPublicKeyMaterial({
    algorithm: "X25519",
    createdAt: "2026-11-19T00:00:00.000Z",
    deviceId,
    publicKey,
    revokedAt: null,
    userId,
  });

const alice = createDeviceKeyPair();
const bob = createDeviceKeyPair();
const group = createInitialGroupEpoch({
  creator: { deviceId: "alice-phone", privateKey: alice.privateKey },
  groupId: "group-1",
  recipients: [
    recipient("alice-phone", "alice", alice.publicKey),
    recipient("bob-phone", "bob", bob.publicKey),
  ],
});
const point = (time: number) =>
  encodeTrackingPoint({
    accuracy: 5,
    battery: { charging: false, level: 80 },
    latitude: 51.5,
    longitude: -0.12,
    speed: 0,
    stayUntil: null,
    time,
  });
const metadata = (overrides: Partial<Pick<EncryptedPayload, "kind" | "senderDeviceId">> = {}) => ({
  epochId: group.epoch.epochId,
  groupId: "group-1",
  kind: TRACKING_POINT_KIND,
  senderDeviceId: "alice-phone",
  ...overrides,
});
const encrypt = (payload: Uint8Array, overrides: Parameters<typeof metadata>[0] = {}) =>
  encryptGroupPayload({
    ...metadata(overrides),
    epochKey: group.epochKey,
    payload,
  });

describe("swapping group payloads between members, groups and fields", () => {
  test("Alice's location relabelled as Bob's doesn't open", () => {
    const alicePoint = encrypt(point(1));
    const asBob = { ...alicePoint, senderDeviceId: "bob-phone" };

    expect(() =>
      decryptGroupPayload({
        encryptedPayload: asBob,
        epochKey: group.epochKey,
        expectedMetadata: metadata({ senderDeviceId: "bob-phone" }),
      }),
    ).toThrow();
  });

  test("a place geometry can't be read as a location, or the other way round", () => {
    const geometry = encrypt(
      encodePlaceGeometryV1({
        latitude: 51.5,
        longitude: -0.12,
        radiusMeters: 100,
        v: 1,
      }),
      { kind: PLACE_GEOMETRY_KIND },
    );
    const location = encrypt(point(1));

    expect(() =>
      decryptGroupPayload({
        encryptedPayload: { ...geometry, kind: TRACKING_POINT_KIND },
        epochKey: group.epochKey,
        expectedMetadata: metadata(),
      }),
    ).toThrow();
    expect(() =>
      decryptGroupPayload({
        encryptedPayload: { ...location, kind: PLACE_GEOMETRY_KIND },
        epochKey: group.epochKey,
        expectedMetadata: metadata({ kind: PLACE_GEOMETRY_KIND }),
      }),
    ).toThrow();
  });

  test("a picture key can't be read as a group payload under the same epoch key", () => {
    const encryptedKey = encryptImageKey({
      epochId: group.epoch.epochId,
      epochKey: group.epochKey,
      fileName: "3f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f13",
      groupId: "group-1",
      imageKey: generateImageKey(),
      kind: "profile-image-key",
      ownerId: "alice",
      senderDeviceId: "alice-phone",
    });

    for (const kind of [TRACKING_POINT_KIND, PLACE_GEOMETRY_KIND, "profile-image-key"]) {
      expect(() =>
        decryptGroupPayload({
          encryptedPayload: {
            ...encryptedKey,
            createdAt: new Date(0),
            groupId: "group-1",
            kind,
          },
          epochKey: group.epochKey,
          expectedMetadata: metadata({ kind }),
        }),
      ).toThrow();
    }
  });

  test("a payload moved to another group that happens to share the epoch id doesn't open", () => {
    const location = encrypt(point(1));

    expect(() =>
      decryptGroupPayload({
        encryptedPayload: { ...location, groupId: "group-2" },
        epochKey: group.epochKey,
        expectedMetadata: { ...metadata(), groupId: "group-2" },
      }),
    ).toThrow();
  });

  test("a replayed location still decrypts to its original time, so a replay can't pass as new", () => {
    const old = encrypt(point(Date.parse("2026-11-01T08:00:00Z")));
    const replayed = { ...old, createdAt: new Date("2026-11-19T08:00:00Z") };
    const opened = decryptGroupPayload({
      encryptedPayload: replayed,
      epochKey: group.epochKey,
      expectedMetadata: metadata(),
    });

    expect(decodeTrackingPoint(opened.bytes.expose()).time).toBe(
      Date.parse("2026-11-01T08:00:00Z"),
    );
  });

  test("bound fields can't be shifted across each other's boundaries", () => {
    const shifted = encryptGroupPayload({
      epochId: "epoch-1",
      epochKey: group.epochKey,
      groupId: 'group","kind":"x',
      kind: TRACKING_POINT_KIND,
      payload: point(1),
      senderDeviceId: "alice-phone",
    });

    expect(() =>
      decryptGroupPayload({
        encryptedPayload: { ...shifted, groupId: "group", kind: "x" },
        epochKey: group.epochKey,
        expectedMetadata: {
          epochId: "epoch-1",
          groupId: "group",
          kind: "x",
          senderDeviceId: "alice-phone",
        },
      }),
    ).toThrow();
  });
});

describe("swapping personal data between people, groups, members and fields", () => {
  const aliceHistory = createHistoryKeyPair();
  const bobHistory = createHistoryKeyPair();
  const seal = (purpose: PersonalDataPurpose, binding: string[], plaintext = "secret") =>
    sealPersonalDataForHistoryKey({
      binding,
      historyKey: { publicKey: aliceHistory.publicKey, version: 1 },
      plaintext,
      purpose,
    });
  const open = (purpose: PersonalDataPurpose, binding: string[], sealed: string) =>
    openPersonalData({
      binding,
      historyPrivateKeys: new Map([[1, aliceHistory.privateKey]]),
      purpose,
      sealed,
    });

  test("a nickname doesn't open for another member, another group, as a colour or as a picture key", () => {
    const nickname = seal("nickname", ["alice", "group-1", "bob"]);

    expect(open("nickname", ["alice", "group-1", "bob"], nickname)).toBe("secret");
    expect(
      openedVariants(
        [
          ["nickname", ["alice", "group-1", "carol"]],
          ["nickname", ["alice", "group-2", "bob"]],
          ["nickname", ["bob", "group-1", "bob"]],
          ["nickname", ["alice", "group-1"]],
          ["nickname", ["alice", "group-1", "bob", ""]],
          ["group-color", ["alice", "group-1", "bob"]],
          ["group-color", ["alice", "group-1"]],
          ["profile-image", ["alice", "group-1", "bob"]],
        ] satisfies [PersonalDataPurpose, string[]][],
        ([purpose, binding]) => open(purpose, binding, nickname),
      ),
    ).toEqual([]);
  });

  test("a group colour doesn't open for another group or as a nickname", () => {
    const colour = seal("group-color", ["alice", "group-1"], "#ff8800");

    expect(open("group-color", ["alice", "group-1"], colour)).toBe("#ff8800");
    expect(
      openedVariants(
        [
          ["group-color", ["alice", "group-2"]],
          ["group-color", ["bob", "group-1"]],
          ["nickname", ["alice", "group-1"]],
        ] satisfies [PersonalDataPurpose, string[]][],
        ([purpose, binding]) => open(purpose, binding, colour),
      ),
    ).toEqual([]);
  });

  test("bindings that join to the same text are still different", () => {
    const sealed = seal("nickname", ["alice", "group-1", "bob"]);

    expect(
      openedVariants(
        [
          ["alicegroup-1", "bob"],
          ["alice", "group-1bob"],
          ["alice,group-1", "bob"],
          ['alice","group-1', "bob"],
          ["alice", "group-1", "bob "],
        ],
        (binding) => open("nickname", binding, sealed),
      ),
    ).toEqual([]);
  });

  test("Alice's records don't open with Bob's History key", () => {
    const nickname = seal("nickname", ["alice", "group-1", "bob"]);

    expect(() =>
      openPersonalData({
        binding: ["alice", "group-1", "bob"],
        historyPrivateKeys: new Map([[1, bobHistory.privateKey]]),
        purpose: "nickname",
        sealed: nickname,
      }),
    ).toThrow();
  });

  test.skip("FINDING: personal data isn't authenticated, so anyone holding the History public key (the server) can forge a nickname or colour that opens", () => {
    const forged = sealPersonalDataForHistoryKey({
      binding: ["alice", "group-1", "bob"],
      historyKey: { publicKey: aliceHistory.publicKey, version: 1 },
      plaintext: "forged by the server",
      purpose: "nickname",
    });

    expect(() => open("nickname", ["alice", "group-1", "bob"], forged)).toThrow();
  });

  test.skip("FINDING: a profile picture's personal key copy can be forged by anyone holding the History public key", () => {
    const attackerKey = generateImageKey();
    const forged = sealProfileImageKey({
      fileName: "3f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f13",
      historyKey: { publicKey: aliceHistory.publicKey, version: 1 },
      imageKey: attackerKey,
      userId: "alice",
    });

    expect(() =>
      openProfileImageKey({
        fileName: "3f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f13",
        historyPrivateKeys: new Map([[1, aliceHistory.privateKey]]),
        sealed: forged,
        userId: "alice",
      }),
    ).toThrow();
  });
});

describe("swapping pictures and picture keys", () => {
  const fileName = "3f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f13";
  const bytes = Uint8Array.from({ length: 64 }, (_, index) => index);

  test("Alice's profile picture can't be shown as Bob's or as a group picture", () => {
    const { blob, key } = encryptImage({
      bytes,
      fileName,
      ownerId: "alice",
      purpose: "profile-image",
    });

    expect(
      openedVariants(
        [
          { fileName, ownerId: "bob", purpose: "profile-image" },
          { fileName, ownerId: "alice", purpose: "group-image" },
          {
            fileName: "4f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f13",
            ownerId: "alice",
            purpose: "profile-image",
          },
        ] as const,
        (context) => decryptImage({ ...context, blob, key }),
      ),
    ).toEqual([]);
  });

  test("a picture key moved to another group, owner, file, kind, epoch or sender doesn't open", () => {
    const context = {
      epochId: group.epoch.epochId,
      fileName,
      groupId: "group-1",
      kind: "profile-image-key",
      ownerId: "alice",
    } as const;
    const encryptedKey = encryptImageKey({
      ...context,
      epochKey: group.epochKey,
      imageKey: generateImageKey(),
      senderDeviceId: "alice-phone",
    });

    expect(
      openedVariants(
        [
          { ...context, groupId: "group-2" },
          { ...context, ownerId: "bob" },
          { ...context, fileName: "4f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f13" },
          { ...context, kind: "group-image-key" },
        ] as const,
        (changed) =>
          decryptImageKey({
            ...changed,
            encryptedKey,
            epochKey: group.epochKey,
          }),
      ),
    ).toEqual([]);
    expect(
      openedVariants(
        [
          { ...encryptedKey, epochId: "epoch-other" },
          { ...encryptedKey, senderDeviceId: "bob-phone" },
        ],
        (changed) =>
          decryptImageKey({
            ...context,
            encryptedKey: changed,
            epochKey: group.epochKey,
          }),
      ),
    ).toEqual([]);
  });
});

describe("epoch key wraps across groups", () => {
  test("a device wrap moved to another recipient doesn't open, even for that recipient", () => {
    const aliceWrap = group.wrappedKeys.find((wrap) => wrap.recipientDeviceId === "alice-phone");
    if (!aliceWrap) throw new Error("Missing Alice's wrap.");

    expect(() =>
      unwrapEpochKey({
        recipientDeviceId: "bob-phone",
        recipientPrivateKey: bob.privateKey,
        wrappedEpochKey: { ...aliceWrap, recipientDeviceId: "bob-phone" },
      }),
    ).toThrow();
  });

  test.skip("FINDING: a device wrap names no group, so the server can serve group A's epoch key as group B's and a phone in both groups encrypts B's locations under A's key", () => {
    const bobWrap = group.wrappedKeys.find((wrap) => wrap.recipientDeviceId === "bob-phone");
    if (!bobWrap) throw new Error("Missing Bob's wrap.");
    const unwrapForGroup = (_groupId: string) =>
      unwrapEpochKey({
        recipientDeviceId: "bob-phone",
        recipientPrivateKey: bob.privateKey,
        wrappedEpochKey: bobWrap,
      });

    expect(() => unwrapForGroup("group-2")).toThrow();
  });

  test.skip("FINDING: a History wrap names no group either", () => {
    const history = createHistoryKeyPair();
    const wrap = wrapEpochKeyForHistoryKey({
      epochId: group.epoch.epochId,
      epochKey: group.epochKey,
      historyKey: { publicKey: history.publicKey, userId: "bob", version: 1 },
      senderPrivateKey: alice.privateKey,
    });
    const unwrapForGroup = (_groupId: string) =>
      unwrapHistoryEpochKey({
        epochId: group.epoch.epochId,
        historyKeyVersion: 1,
        historyPrivateKey: history.privateKey,
        userId: "bob",
        wrappedEpochKey: wrap,
      });

    expect(() => unwrapForGroup("group-2")).toThrow();
  });

  test.todo(
    "FINDING: unwrapEpochKey can't be told which sender to expect, so HPKE Auth only proves the wrap came from the key it names; a phone can't reject a wrap from a removed member or the server (OPE-213)",
  );
});
