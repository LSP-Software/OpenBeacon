import { describe, expect, test } from "bun:test";
import {
  createHistoryKeyPair,
  decodeBase64,
  decryptImage,
  decryptImageKey,
  encodeBase64,
  encryptImage,
  encryptGroupPayload,
  encryptImageKey,
  generateGroupEpochKey,
  generateImageKey,
  ImageKeyMaterial,
  MIN_ENCRYPTED_IMAGE_LENGTH,
  openPersonalData,
  openProfileImageKey,
  sealPersonalDataForHistoryKey,
  sealProfileImageKey,
} from "./index.ts";

const picture = Uint8Array.from({ length: 2048 }, (_, index) => (index * 31 + 7) % 256);

const pictureContext = {
  fileName: "3f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f13",
  ownerId: "user_1",
  purpose: "profile-image",
} as const;

const keyContext = {
  epochId: "epoch_2",
  fileName: "3f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f13",
  groupId: "group_1",
  kind: "profile-image-key",
  ownerId: "user_1",
  senderDeviceId: "device_1",
} as const;

const flipByte = (bytes: Uint8Array, index: number) => {
  const copy = Uint8Array.from(bytes);
  copy[index] = (copy[index] ?? 0) ^ 1;
  return copy;
};

describe("encryptImage", () => {
  test("round trips a picture", () => {
    const { blob, key } = encryptImage({ ...pictureContext, bytes: picture });

    expect(decryptImage({ ...pictureContext, blob, key })).toEqual(picture);
  });

  test("round trips a key restored from its raw bytes", () => {
    const { blob, key } = encryptImage({ ...pictureContext, bytes: picture });
    const restored = new ImageKeyMaterial(decodeBase64(encodeBase64(key.expose())));

    expect(decryptImage({ ...pictureContext, blob, key: restored })).toEqual(picture);
  });

  test("writes version 1, then the nonce, then ciphertext and tag", () => {
    const { blob } = encryptImage({ ...pictureContext, bytes: picture });

    expect(blob[0]).toBe(1);
    expect(blob.length).toBe(MIN_ENCRYPTED_IMAGE_LENGTH + picture.length);
    expect(MIN_ENCRYPTED_IMAGE_LENGTH).toBe(1 + 24 + 16);
  });

  test("uses a fresh key and nonce for every picture", () => {
    const first = encryptImage({ ...pictureContext, bytes: picture });
    const second = encryptImage({ ...pictureContext, bytes: picture });

    expect(first.key.expose()).not.toEqual(second.key.expose());
    expect(first.blob.subarray(1, 25)).not.toEqual(second.blob.subarray(1, 25));
    expect(first.key.expose().length).toBe(32);
  });

  test("never serialises the key", () => {
    const { key } = encryptImage({ ...pictureContext, bytes: picture });

    expect(JSON.stringify({ key })).toBe('{"key":"[REDACTED image key]"}');
    expect(String(key)).toBe("[REDACTED image key]");
  });

  test("round trips an empty picture", () => {
    const { blob, key } = encryptImage({ ...pictureContext, bytes: new Uint8Array() });

    expect(blob.length).toBe(MIN_ENCRYPTED_IMAGE_LENGTH);
    expect(decryptImage({ ...pictureContext, blob, key })).toEqual(new Uint8Array());
  });

  test("rejects a key or nonce of the wrong length", () => {
    expect(() =>
      encryptImage({
        ...pictureContext,
        bytes: picture,
        key: new ImageKeyMaterial(new Uint8Array(16)),
      }),
    ).toThrow("Invalid key length.");
    expect(() =>
      encryptImage({ ...pictureContext, bytes: picture, nonce: new Uint8Array(12) }),
    ).toThrow("Invalid nonce length.");
  });
});

describe("decryptImage", () => {
  const { blob, key } = encryptImage({ ...pictureContext, bytes: picture });

  test("rejects a tampered nonce, ciphertext or tag", () => {
    for (const index of [1, 24, 25, 25 + picture.length / 2, blob.length - 1]) {
      expect(() => decryptImage({ ...pictureContext, blob: flipByte(blob, index), key })).toThrow();
    }
  });

  test("rejects the picture under another owner", () => {
    expect(() => decryptImage({ ...pictureContext, blob, key, ownerId: "user_2" })).toThrow();
  });

  test("rejects the picture under another file name", () => {
    expect(() =>
      decryptImage({
        ...pictureContext,
        blob,
        fileName: "b7e2d4c1-5a3f-4c9e-8d2b-6f1a0e9c7b35",
        key,
      }),
    ).toThrow();
  });

  test("rejects the picture under another purpose", () => {
    expect(() => decryptImage({ ...pictureContext, blob, key, purpose: "group-image" })).toThrow();
  });

  test("rejects a group picture whose group ID is reused as a profile owner", () => {
    const group = encryptImage({
      bytes: picture,
      fileName: pictureContext.fileName,
      ownerId: "shared_id",
      purpose: "group-image",
    });

    expect(() =>
      decryptImage({
        ...pictureContext,
        blob: group.blob,
        key: group.key,
        ownerId: "shared_id",
      }),
    ).toThrow();
  });

  test("rejects the wrong key", () => {
    expect(() => decryptImage({ ...pictureContext, blob, key: generateImageKey() })).toThrow();
    expect(() =>
      decryptImage({ ...pictureContext, blob, key: new ImageKeyMaterial(new Uint8Array(16)) }),
    ).toThrow("Invalid key length.");
  });

  test("rejects an unknown version byte", () => {
    for (const version of [0, 2, 255]) {
      const changed = Uint8Array.from(blob);
      changed[0] = version;

      expect(() => decryptImage({ ...pictureContext, blob: changed, key })).toThrow(
        "Unsupported encrypted image version.",
      );
    }
  });

  test("rejects a truncated blob", () => {
    for (const length of [0, 1, 25, MIN_ENCRYPTED_IMAGE_LENGTH - 1]) {
      expect(() =>
        decryptImage({ ...pictureContext, blob: blob.subarray(0, length), key }),
      ).toThrow("Encrypted image is too short.");
    }
    expect(() => decryptImage({ ...pictureContext, blob: blob.subarray(0, -1), key })).toThrow();
    expect(() =>
      decryptImage({ ...pictureContext, blob: blob.subarray(0, MIN_ENCRYPTED_IMAGE_LENGTH), key }),
    ).toThrow();
  });

  test("rejects a blob with bytes appended", () => {
    const longer = new Uint8Array(blob.length + 1);
    longer.set(blob);

    expect(() => decryptImage({ ...pictureContext, blob: longer, key })).toThrow();
  });
});

describe("encryptImageKey", () => {
  const epochKey = generateGroupEpochKey();
  const imageKey = generateImageKey();
  const encryptedKey = encryptImageKey({ ...keyContext, epochKey, imageKey });

  test("round trips a picture key", () => {
    const decrypted = decryptImageKey({ ...keyContext, encryptedKey, epochKey });

    expect(decrypted).toBeInstanceOf(ImageKeyMaterial);
    expect(decrypted.expose()).toEqual(imageKey.expose());
  });

  test("returns the Place-style columns and nothing in plain text", () => {
    expect(Object.keys(encryptedKey).sort()).toEqual([
      "algorithm",
      "ciphertext",
      "epochId",
      "nonce",
      "senderDeviceId",
    ]);
    expect(encryptedKey.algorithm).toBe("XChaCha20-Poly1305");
    expect(encryptedKey.epochId).toBe(keyContext.epochId);
    expect(encryptedKey.senderDeviceId).toBe(keyContext.senderDeviceId);
    expect(decodeBase64(encryptedKey.ciphertext).length).toBe(32 + 16);
    expect(encryptedKey.ciphertext).not.toContain(encodeBase64(imageKey.expose()));
  });

  test("uses a fresh nonce every time", () => {
    const again = encryptImageKey({ ...keyContext, epochKey, imageKey });

    expect(again.nonce).not.toBe(encryptedKey.nonce);
    expect(again.ciphertext).not.toBe(encryptedKey.ciphertext);
  });

  test("decrypts a picture that was encrypted with the unwrapped key", () => {
    const { blob, key } = encryptImage({ ...pictureContext, bytes: picture });
    const unwrapped = decryptImageKey({
      ...keyContext,
      encryptedKey: encryptImageKey({ ...keyContext, epochKey, imageKey: key }),
      epochKey,
    });

    expect(decryptImage({ ...pictureContext, blob, key: unwrapped })).toEqual(picture);
  });

  test("rejects an epoch key or picture key of the wrong length", () => {
    expect(() =>
      encryptImageKey({
        ...keyContext,
        epochKey: generateGroupEpochKey(),
        imageKey: new ImageKeyMaterial(new Uint8Array(31)),
      }),
    ).toThrow("Invalid key length.");
  });
});

describe("decryptImageKey", () => {
  const epochKey = generateGroupEpochKey();
  const encryptedKey = encryptImageKey({ ...keyContext, epochKey, imageKey: generateImageKey() });

  test("rejects each changed binding", () => {
    for (const changed of [
      { groupId: "group_2" },
      { kind: "group-image-key" },
      { ownerId: "user_2" },
      { fileName: "b7e2d4c1-5a3f-4c9e-8d2b-6f1a0e9c7b35" },
    ] as const) {
      expect(() =>
        decryptImageKey({ ...keyContext, ...changed, encryptedKey, epochKey }),
      ).toThrow();
    }
  });

  test("rejects a changed epoch or sender in the stored columns", () => {
    for (const changed of [{ epochId: "epoch_1" }, { senderDeviceId: "device_2" }]) {
      expect(() =>
        decryptImageKey({
          ...keyContext,
          encryptedKey: { ...encryptedKey, ...changed },
          epochKey,
        }),
      ).toThrow();
    }
  });

  test("rejects another epoch's key", () => {
    expect(() =>
      decryptImageKey({ ...keyContext, encryptedKey, epochKey: generateGroupEpochKey() }),
    ).toThrow();
  });

  test("rejects a tampered ciphertext or nonce", () => {
    for (const field of ["ciphertext", "nonce"] as const) {
      const tampered = encodeBase64(flipByte(decodeBase64(encryptedKey[field]), 0));

      expect(() =>
        decryptImageKey({
          ...keyContext,
          encryptedKey: { ...encryptedKey, [field]: tampered },
          epochKey,
        }),
      ).toThrow();
    }
  });

  test("rejects a truncated ciphertext or short nonce", () => {
    expect(() =>
      decryptImageKey({
        ...keyContext,
        encryptedKey: {
          ...encryptedKey,
          ciphertext: encodeBase64(decodeBase64(encryptedKey.ciphertext).subarray(0, 40)),
        },
        epochKey,
      }),
    ).toThrow();
    expect(() =>
      decryptImageKey({
        ...keyContext,
        encryptedKey: { ...encryptedKey, nonce: encodeBase64(new Uint8Array(12)) },
        epochKey,
      }),
    ).toThrow("Invalid nonce length.");
  });

  test("rejects an unknown algorithm", () => {
    expect(() =>
      decryptImageKey({
        ...keyContext,
        encryptedKey: { ...encryptedKey, algorithm: "AES-256-GCM" },
        epochKey,
      }),
    ).toThrow("Unsupported image key algorithm.");
  });

  test("rejects a group payload made with the same epoch key", () => {
    const payload = encryptGroupPayload({
      epochId: keyContext.epochId,
      epochKey,
      groupId: keyContext.groupId,
      kind: keyContext.kind,
      payload: generateImageKey().expose(),
      senderDeviceId: keyContext.senderDeviceId,
    });

    expect(() =>
      decryptImageKey({
        ...keyContext,
        encryptedKey: {
          algorithm: payload.algorithm,
          ciphertext: payload.ciphertext,
          epochId: payload.epochId,
          nonce: payload.nonce,
          senderDeviceId: payload.senderDeviceId,
        },
        epochKey,
      }),
    ).toThrow();
  });
});

describe("profile picture personal copy", () => {
  const history = createHistoryKeyPair();
  const historyKey = { publicKey: history.publicKey, version: 3 };
  const historyPrivateKeys = new Map([[3, history.privateKey]]);
  const imageKey = generateImageKey();
  const sealed = sealProfileImageKey({
    fileName: pictureContext.fileName,
    historyKey,
    imageKey,
    userId: "user_1",
  });

  test("round trips through the history key", () => {
    const opened = openProfileImageKey({
      fileName: pictureContext.fileName,
      historyPrivateKeys,
      sealed,
      userId: "user_1",
    });

    expect(opened).toBeInstanceOf(ImageKeyMaterial);
    expect(opened.expose()).toEqual(imageKey.expose());
    expect(sealed).not.toContain(encodeBase64(imageKey.expose()));
  });

  test("is the profile-image personal data seal over [userId, fileName] and the base64 key", () => {
    const manual = sealPersonalDataForHistoryKey({
      historyKey,
      purpose: "profile-image",
      binding: ["user_1", pictureContext.fileName],
      plaintext: encodeBase64(imageKey.expose()),
    });

    expect(
      openPersonalData({
        historyPrivateKeys,
        purpose: "profile-image",
        binding: ["user_1", pictureContext.fileName],
        sealed,
      }),
    ).toBe(encodeBase64(imageKey.expose()));
    expect(
      openProfileImageKey({
        fileName: pictureContext.fileName,
        historyPrivateKeys,
        sealed: manual,
        userId: "user_1",
      }).expose(),
    ).toEqual(imageKey.expose());
  });

  test("rejects another user, file name or purpose", () => {
    expect(() =>
      openProfileImageKey({
        fileName: pictureContext.fileName,
        historyPrivateKeys,
        sealed,
        userId: "user_2",
      }),
    ).toThrow();
    expect(() =>
      openProfileImageKey({
        fileName: "b7e2d4c1-5a3f-4c9e-8d2b-6f1a0e9c7b35",
        historyPrivateKeys,
        sealed,
        userId: "user_1",
      }),
    ).toThrow();
    expect(() =>
      openPersonalData({
        historyPrivateKeys,
        purpose: "nickname",
        binding: ["user_1", pictureContext.fileName],
        sealed,
      }),
    ).toThrow();
  });

  test("rejects a phone without that history key version", () => {
    expect(() =>
      openProfileImageKey({
        fileName: pictureContext.fileName,
        historyPrivateKeys: new Map([[2, history.privateKey]]),
        sealed,
        userId: "user_1",
      }),
    ).toThrow("Missing history key for personal data.");
  });

  test("rejects a sealed value that isn't a 32-byte key", () => {
    const short = sealPersonalDataForHistoryKey({
      historyKey,
      purpose: "profile-image",
      binding: ["user_1", pictureContext.fileName],
      plaintext: encodeBase64(new Uint8Array(16)),
    });

    expect(() =>
      openProfileImageKey({
        fileName: pictureContext.fileName,
        historyPrivateKeys,
        sealed: short,
        userId: "user_1",
      }),
    ).toThrow("Invalid key length.");
  });
});
