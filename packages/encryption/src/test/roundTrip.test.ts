import { describe, expect, test } from "bun:test";
import {
  createDeviceKeyPair,
  createDeviceLinkSecret,
  createHistoryKeyPair,
  decodeBase64,
  decodeTrackingPoint,
  decryptGroupPayload,
  decryptImage,
  decryptImageKey,
  encodeBase64,
  encodePlaceGeometryV1,
  encodeTrackingPoint,
  ENCRYPTED_TRACKING_POINT_LENGTH,
  encryptGroupPayload,
  encryptImage,
  encryptImageKey,
  generateGroupEpochKey,
  generateImageKey,
  openPersonalData,
  PLACE_GEOMETRY_KIND,
  type PersonalDataPurpose,
  sealDeviceLinkHandover,
  sealPersonalDataForHistoryKey,
  sealProfileImageKey,
  serializeRecipientPublicKeyMaterial,
  TRACKING_POINT_KIND,
  TRACKING_POINT_LENGTH,
  type TrackingPoint,
  unwrapEpochKey,
  unwrapHistoryEpochKey,
  wrapEpochKeyForHistoryKey,
  wrapEpochKeyForRecipient,
} from "../index.ts";
import { flipBit, seededRandom } from "./adversarial.ts";

const RUNS = 200;

describe("base64", () => {
  test("matches the platform encoder for random bytes of every length up to 300", () => {
    const random = seededRandom(1);
    for (let length = 0; length <= 300; length += 1) {
      const bytes = random.bytes(length);
      const encoded = encodeBase64(bytes);

      expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
      expect(decodeBase64(encoded)).toEqual(bytes);
    }
  });

  test.skip("FINDING: decodeBase64 accepts non-canonical trailing bits, so one ciphertext has several valid spellings", () => {
    expect(decodeBase64("AB==")).toEqual(decodeBase64("AA=="));
    expect(() => decodeBase64("AB==")).toThrow();
    expect(() => decodeBase64("AAB=")).toThrow();
  });
});

describe("tracking points", () => {
  const randomPoint = (random: ReturnType<typeof seededRandom>): TrackingPoint => {
    const time = random.int(0, 2 ** 47);
    return {
      accuracy: random.next() < 0.2 ? null : random.int(0, 655_340) / 100,
      battery: {
        charging: random.next() < 0.5,
        level: random.next() < 0.2 ? null : random.int(0, 100),
      },
      latitude: (random.next() * 2 - 1) * 90,
      longitude: (random.next() * 2 - 1) * 180,
      speed: random.next() < 0.2 ? null : random.int(0, 655_340) / 1000,
      stayUntil: random.next() < 0.5 ? null : time + random.int(0, 65_535) * 60_000,
      time,
    };
  };

  test("random points round trip within the documented precision", () => {
    const random = seededRandom(2);
    for (let run = 0; run < RUNS * 5; run += 1) {
      const point = randomPoint(random);
      const decoded = decodeTrackingPoint(encodeTrackingPoint(point));

      expect(Math.abs(decoded.latitude - point.latitude)).toBeLessThanOrEqual(5e-8 + 1e-12);
      expect(Math.abs(decoded.longitude - point.longitude)).toBeLessThanOrEqual(5e-8 + 1e-12);
      expect(decoded.time).toBe(point.time);
      expect(decoded.stayUntil).toBe(point.stayUntil);
      expect(decoded.battery).toEqual(point.battery);
      expect(decoded.accuracy === null).toBe(point.accuracy === null);
      expect(Math.abs((decoded.accuracy ?? 0) - (point.accuracy ?? 0))).toBeLessThanOrEqual(
        0.05 + 1e-9,
      );
      expect(decoded.speed === null).toBe(point.speed === null);
      expect(Math.abs((decoded.speed ?? 0) - (point.speed ?? 0))).toBeLessThanOrEqual(0.005 + 1e-9);
    }
  });

  test("every 23-byte payload either fails to decode or re-encodes to the same bytes", () => {
    const random = seededRandom(3);
    let decoded = 0;
    for (let run = 0; run < RUNS * 25; run += 1) {
      const bytes = random.bytes(TRACKING_POINT_LENGTH);
      bytes[0] = 2;
      bytes[22] = random.int(0, 1);
      if (bytes[22] === 0 && random.next() < 0.5) {
        bytes[15] = 0;
        bytes[16] = 0;
      }
      let point: TrackingPoint;
      try {
        point = decodeTrackingPoint(bytes);
      } catch {
        continue;
      }
      decoded += 1;
      expect(encodeTrackingPoint(point)).toEqual(bytes);
    }
    expect(decoded).toBeGreaterThan(RUNS);
  });

  test("payloads of any other length are refused", () => {
    const random = seededRandom(4);
    for (let length = 0; length <= 64; length += 1) {
      if (length === TRACKING_POINT_LENGTH) continue;
      expect(() => decodeTrackingPoint(random.bytes(length))).toThrow();
    }
  });
});

describe("group payloads", () => {
  test("random payloads round trip under random identifiers and fail under any other", () => {
    const random = seededRandom(5);
    for (let run = 0; run < RUNS; run += 1) {
      const epochKey = generateGroupEpochKey();
      const metadata = {
        epochId: random.text(20),
        groupId: random.text(20),
        kind: random.text(12),
        senderDeviceId: random.text(20),
      };
      const payload = random.bytes(random.int(0, 2048));
      const encrypted = encryptGroupPayload({ ...metadata, epochKey, payload });

      expect(decodeBase64(encrypted.ciphertext).length).toBe(payload.length + 16);
      expect(
        decryptGroupPayload({
          encryptedPayload: encrypted,
          epochKey,
          expectedMetadata: metadata,
        }).bytes.expose(),
      ).toEqual(payload);

      const field = (["epochId", "groupId", "kind", "senderDeviceId"] as const)[random.int(0, 3)];
      if (!field) throw new Error("No field picked.");
      const changed = { ...metadata, [field]: `${metadata[field]}.` };
      expect(() =>
        decryptGroupPayload({
          encryptedPayload: { ...encrypted, ...changed },
          epochKey,
          expectedMetadata: changed,
        }),
      ).toThrow();
    }
  });

  test("an encrypted tracking point is always the fixed length the server checks for", () => {
    const epochKey = generateGroupEpochKey();
    const encrypted = encryptGroupPayload({
      epochId: "epoch-1",
      epochKey,
      groupId: "group-1",
      kind: TRACKING_POINT_KIND,
      payload: encodeTrackingPoint({
        accuracy: null,
        battery: { charging: false, level: null },
        latitude: 0,
        longitude: 0,
        speed: null,
        stayUntil: null,
        time: 0,
      }),
      senderDeviceId: "device-1",
    });

    expect(decodeBase64(encrypted.ciphertext).length).toBe(ENCRYPTED_TRACKING_POINT_LENGTH);
  });

  test("an encrypted place geometry fits the server's 512 character limit", () => {
    const encrypted = encryptGroupPayload({
      epochId: "epoch-1",
      epochKey: generateGroupEpochKey(),
      groupId: "group-1",
      kind: PLACE_GEOMETRY_KIND,
      payload: encodePlaceGeometryV1({
        latitude: -89.1234567890123,
        longitude: -179.123456789012,
        radiusMeters: 1000,
        v: 1,
      }),
      senderDeviceId: "device-1",
    });

    expect(encrypted.ciphertext.length).toBeLessThanOrEqual(512);
  });
});

describe("epoch key wraps", () => {
  test("random epoch keys round trip through device and History wraps", () => {
    const random = seededRandom(6);
    const sender = createDeviceKeyPair();
    for (let run = 0; run < 40; run += 1) {
      const receiver = createDeviceKeyPair();
      const history = createHistoryKeyPair();
      const epochKey = generateGroupEpochKey();
      const epochId = random.text(24);
      const deviceId = random.text(24);
      const userId = random.text(24);
      const version = random.int(1, 10_000);
      const deviceWrap = wrapEpochKeyForRecipient({
        epoch: {
          createdAt: new Date(0),
          createdByDeviceId: "sender",
          epochId,
          epochNumber: 1,
          groupId: "group-1",
        },
        epochKey,
        recipient: serializeRecipientPublicKeyMaterial({
          algorithm: "X25519",
          createdAt: new Date(0),
          deviceId,
          publicKey: receiver.publicKey,
          revokedAt: null,
          userId,
        }),
        senderPrivateKey: sender.privateKey,
      });
      const historyWrap = wrapEpochKeyForHistoryKey({
        epochId,
        epochKey,
        historyKey: { publicKey: history.publicKey, userId, version },
        senderPrivateKey: sender.privateKey,
      });

      expect(
        unwrapEpochKey({
          recipientDeviceId: deviceId,
          recipientPrivateKey: receiver.privateKey,
          wrappedEpochKey: deviceWrap,
        }).expose(),
      ).toEqual(epochKey.expose());
      expect(
        unwrapHistoryEpochKey({
          epochId,
          historyKeyVersion: version,
          historyPrivateKey: history.privateKey,
          userId,
          wrappedEpochKey: historyWrap,
        }).expose(),
      ).toEqual(epochKey.expose());
    }
  });
});

describe("personal data", () => {
  const history = createHistoryKeyPair();
  const purposes: PersonalDataPurpose[] = ["nickname", "group-color", "profile-image"];

  test("random text round trips under random bindings and fails when the binding shifts", () => {
    const random = seededRandom(7);
    for (let run = 0; run < 60; run += 1) {
      const purpose = purposes[random.int(0, 2)] ?? "nickname";
      const binding = Array.from({ length: random.int(1, 4) }, () => random.text(12));
      const plaintext = random.text(120);
      const sealed = sealPersonalDataForHistoryKey({
        binding,
        historyKey: { publicKey: history.publicKey, version: 1 },
        plaintext,
        purpose,
      });
      const open = (openBinding: string[]) =>
        openPersonalData({
          binding: openBinding,
          historyPrivateKeys: new Map([[1, history.privateKey]]),
          purpose,
          sealed,
        });

      expect(open(binding)).toBe(plaintext);
      expect(() => open([...binding, ""])).toThrow();
      if (binding.length > 1) {
        expect(() => open([binding.join("")])).toThrow();
        if (binding.join("\u0000") !== binding.slice().reverse().join("\u0000")) {
          expect(() => open(binding.slice().reverse())).toThrow();
        }
      }
    }
  });

  test("the longest nickname the app allows seals well inside the server's 50,000 character limit", () => {
    const sealed = sealPersonalDataForHistoryKey({
      binding: ["user".repeat(20), "group".repeat(20), "member".repeat(20)],
      historyKey: { publicKey: history.publicKey, version: 2 ** 31 - 1 },
      plaintext: "語".repeat(100),
      purpose: "nickname",
    });

    expect(sealed.length).toBeLessThan(50_000);
    expect(
      openPersonalData({
        binding: ["user".repeat(20), "group".repeat(20), "member".repeat(20)],
        historyPrivateKeys: new Map([[2 ** 31 - 1, history.privateKey]]),
        purpose: "nickname",
        sealed,
      }),
    ).toBe("語".repeat(100));
  });

  test("a profile picture's personal key copy fits the server's 4,096 character limit", () => {
    const sealed = sealProfileImageKey({
      fileName: "3f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f13",
      historyKey: { publicKey: history.publicKey, version: 2 ** 31 - 1 },
      imageKey: generateImageKey(),
      userId: "u".repeat(200),
    });

    expect(sealed.length).toBeLessThanOrEqual(4096);
  });
});

describe("pictures", () => {
  test("random pictures round trip and reject a flip of a random bit", () => {
    const random = seededRandom(8);
    for (let run = 0; run < 60; run += 1) {
      const context = {
        fileName: random.text(36),
        ownerId: random.text(20),
        purpose: random.next() < 0.5 ? "profile-image" : "group-image",
      } as const;
      const bytes = random.bytes(random.int(0, 8192));
      const { blob, key } = encryptImage({ ...context, bytes });

      expect(blob.length).toBe(bytes.length + 41);
      expect(decryptImage({ ...context, blob, key })).toEqual(bytes);
      expect(() =>
        decryptImage({
          ...context,
          blob: flipBit(blob, random.int(0, blob.length - 1)),
          key,
        }),
      ).toThrow();
    }
  });

  test("a 10 MiB picture round trips and rejects a change to its last byte", () => {
    const context = {
      fileName: "3f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f13",
      ownerId: "user-1",
      purpose: "profile-image",
    } as const;
    const bytes = seededRandom(9).bytes(10 * 1024 * 1024);
    const { blob, key } = encryptImage({ ...context, bytes });

    expect(decryptImage({ ...context, blob, key })).toEqual(bytes);
    expect(() => decryptImage({ ...context, blob: flipBit(blob, blob.length - 1), key })).toThrow();
  });

  test("random picture keys round trip and their ciphertext fits the server's 128 character limit", () => {
    const random = seededRandom(10);
    for (let run = 0; run < RUNS; run += 1) {
      const epochKey = generateGroupEpochKey();
      const imageKey = generateImageKey();
      const context = {
        epochId: random.text(24),
        fileName: random.text(36),
        groupId: random.text(24),
        kind: random.next() < 0.5 ? "profile-image-key" : "group-image-key",
        ownerId: random.text(24),
      } as const;
      const encryptedKey = encryptImageKey({
        ...context,
        epochKey,
        imageKey,
        senderDeviceId: random.text(24),
      });

      expect(encryptedKey.ciphertext.length).toBeLessThanOrEqual(128);
      expect(decryptImageKey({ ...context, encryptedKey, epochKey }).expose()).toEqual(
        imageKey.expose(),
      );
    }
  });
});

describe("device link handover", () => {
  test("the largest handover, 1,000 History keys, fits the server's 200,000 character limit", () => {
    const newDevice = createDeviceKeyPair();
    const historyKeys = Array.from({ length: 1000 }, (_, index) => ({
      privateKey: createHistoryKeyPair().privateKey,
      version: index + 1,
    }));
    const seal = (keys: typeof historyKeys) =>
      sealDeviceLinkHandover({
        approverPrivateKey: createDeviceKeyPair().privateKey,
        historyKeys: keys,
        linkId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
        newDeviceId: "device-new",
        newDevicePublicKey: newDevice.publicKey,
        psk: createDeviceLinkSecret(),
        userId: "user-1",
      });

    expect(seal(historyKeys).ciphertext.length).toBeLessThanOrEqual(200_000);
    expect(() =>
      seal([...historyKeys, { privateKey: createHistoryKeyPair().privateKey, version: 1001 }]),
    ).toThrow();
  });
});
