import { describe, expect, test } from "bun:test";
import {
  createDeviceKeyPair,
  createDeviceLinkSecret,
  createHistoryKeyPair,
  createInitialGroupEpoch,
  decodeBase64,
  decryptGroupPayload,
  decryptImage,
  decryptImageKey,
  deriveRecoveryKeyPair,
  encodeBase64,
  encodeTrackingPoint,
  type EncryptedPayload,
  EpochKeyMaterial,
  encryptGroupPayload,
  encryptImage,
  encryptImageKey,
  generateGroupEpochKey,
  generateImageKey,
  generateRecoveryPhrase,
  type HistoryKeyEscrow,
  openDeviceActivationChallenge,
  openDeviceLinkHandover,
  openHistoryKeyEscrow,
  openPersonalData,
  openProfileImageKey,
  openSessionLinkChallenge,
  sealDeviceActivationChallenge,
  sealDeviceLinkHandover,
  sealHistoryKeyEscrow,
  sealPersonalData,
  sealPersonalDataForHistoryKey,
  sealProfileImageKey,
  sealSessionLinkChallenge,
  serializeRecipientPublicKeyMaterial,
  TRACKING_POINT_KIND,
  unwrapEpochKey,
  unwrapHistoryEpochKey,
  type WrappedEpochKey,
  type WrappedHistoryEpochKey,
  wrapEpochKeyForHistoryKey,
} from "../index.ts";
import {
  base64Extensions,
  everyBase64ByteFlip,
  everyBase64Truncation,
  everyBitFlip,
  everyTruncation,
  openedVariants,
  extensions,
} from "./adversarial.ts";

const bitFlips = (value: string) => everyBitFlip(decodeBase64(value)).map(encodeBase64);

const changeEachCharacter = (value: string) =>
  Array.from(
    { length: value.length },
    (_, index) =>
      `${value.slice(0, index)}${value[index] === "x" ? "y" : "x"}${value.slice(index + 1)}`,
  );

const alice = createDeviceKeyPair();
const bob = createDeviceKeyPair();
const recipient = (deviceId: string, userId: string, publicKey: string) =>
  serializeRecipientPublicKeyMaterial({
    algorithm: "X25519",
    createdAt: "2026-11-19T00:00:00.000Z",
    deviceId,
    publicKey,
    revokedAt: null,
    userId,
  });
const group = createInitialGroupEpoch({
  creator: { deviceId: "alice-phone", privateKey: alice.privateKey },
  groupId: "group-1",
  recipients: [
    recipient("alice-phone", "alice", alice.publicKey),
    recipient("bob-phone", "bob", bob.publicKey),
  ],
});
const bobWrap = group.wrappedKeys.find((wrap) => wrap.recipientDeviceId === "bob-phone");
if (!bobWrap) throw new Error("Missing Bob's wrap.");

const trackingPoint = encodeTrackingPoint({
  accuracy: 12,
  battery: { charging: true, level: 64 },
  latitude: 51.5007,
  longitude: -0.1246,
  speed: 1.4,
  stayUntil: null,
  time: Date.parse("2026-11-19T09:00:00Z"),
});

describe("group payload (locations, battery, place geometry)", () => {
  const metadata = {
    epochId: group.epoch.epochId,
    groupId: "group-1",
    kind: TRACKING_POINT_KIND,
    senderDeviceId: "alice-phone",
  };
  const encrypted = encryptGroupPayload({
    ...metadata,
    epochKey: group.epochKey,
    payload: trackingPoint,
  });
  const open = (payload: EncryptedPayload, expectedMetadata = metadata) =>
    decryptGroupPayload({
      encryptedPayload: payload,
      epochKey: group.epochKey,
      expectedMetadata,
    });

  test("opens the untouched payload", () => {
    expect(open(encrypted).bytes.expose()).toEqual(trackingPoint);
  });

  test("rejects every single-bit change to the ciphertext and tag", () => {
    expect(
      openedVariants(bitFlips(encrypted.ciphertext), (ciphertext) =>
        open({ ...encrypted, ciphertext }),
      ),
    ).toEqual([]);
  });

  test("rejects every single-bit change to the nonce", () => {
    expect(
      openedVariants(bitFlips(encrypted.nonce), (nonce) => open({ ...encrypted, nonce })),
    ).toEqual([]);
  });

  test("rejects every truncation and extension of the ciphertext, including empty", () => {
    expect(
      openedVariants(
        [...everyBase64Truncation(encrypted.ciphertext), ...base64Extensions(encrypted.ciphertext)],
        (ciphertext) => open({ ...encrypted, ciphertext }),
      ),
    ).toEqual([]);
  });

  test("rejects every truncation and extension of the nonce", () => {
    expect(
      openedVariants(
        [...everyBase64Truncation(encrypted.nonce), ...base64Extensions(encrypted.nonce)],
        (nonce) => open({ ...encrypted, nonce }),
      ),
    ).toEqual([]);
  });

  test("rejects ciphertext or nonce that isn't base64", () => {
    expect(
      openedVariants(["*", "AAAA*", "A", "=AAA"], (value) =>
        open({ ...encrypted, ciphertext: value }),
      ),
    ).toEqual([]);
    expect(
      openedVariants(["*", "A", "=AAA"], (value) => open({ ...encrypted, nonce: value })),
    ).toEqual([]);
  });

  test("rejects every one-character change to each bound field, even when relabelled consistently", () => {
    for (const field of ["epochId", "groupId", "kind", "senderDeviceId"] as const) {
      expect(
        openedVariants(changeEachCharacter(metadata[field]), (changed) => {
          const relabelled = { ...metadata, [field]: changed };
          return open({ ...encrypted, ...relabelled }, relabelled);
        }),
      ).toEqual([]);
    }
  });

  test("rejects a 32-byte key that differs from the epoch key in one bit", () => {
    const keyBytes = group.epochKey.expose();
    expect(
      openedVariants(everyBitFlip(keyBytes).slice(0, 64), (bytes) =>
        decryptGroupPayload({
          encryptedPayload: encrypted,
          epochKey: new EpochKeyMaterial(bytes),
          expectedMetadata: metadata,
        }),
      ),
    ).toEqual([]);
  });

  test("refuses epoch keys that aren't 32 bytes", () => {
    for (const length of [0, 16, 31, 33, 64]) {
      expect(() =>
        decryptGroupPayload({
          encryptedPayload: encrypted,
          epochKey: new EpochKeyMaterial(new Uint8Array(length)),
          expectedMetadata: metadata,
        }),
      ).toThrow();
    }
  });
});

describe("device epoch key wrap", () => {
  const open = (wrap: WrappedEpochKey) =>
    unwrapEpochKey({
      recipientDeviceId: "bob-phone",
      recipientPrivateKey: bob.privateKey,
      wrappedEpochKey: wrap,
    });

  test("opens the untouched wrap", () => {
    expect(open(bobWrap).expose()).toEqual(group.epochKey.expose());
  });

  test("rejects every single-bit change to the wrapped key, ephemeral key and sender key", () => {
    for (const field of ["wrappedKey", "ephemeralPublicKey", "senderPublicKey"] as const) {
      expect(
        openedVariants(bitFlips(bobWrap[field]), (value) => open({ ...bobWrap, [field]: value })),
      ).toEqual([]);
    }
  });

  test("rejects every truncation and extension of each field", () => {
    for (const field of ["wrappedKey", "ephemeralPublicKey", "senderPublicKey"] as const) {
      expect(
        openedVariants(
          [...everyBase64Truncation(bobWrap[field]), ...base64Extensions(bobWrap[field])],
          (value) => open({ ...bobWrap, [field]: value }),
        ),
      ).toEqual([]);
    }
  });

  test("rejects every one-character change to the epoch it was wrapped for", () => {
    expect(
      openedVariants(changeEachCharacter(bobWrap.epochId), (epochId) =>
        open({ ...bobWrap, epochId }),
      ),
    ).toEqual([]);
  });
});

describe("History wrap", () => {
  const history = createHistoryKeyPair();
  const historyKey = {
    publicKey: history.publicKey,
    userId: "bob",
    version: 3,
  };
  const wrap = wrapEpochKeyForHistoryKey({
    epochId: group.epoch.epochId,
    epochKey: group.epochKey,
    historyKey,
    senderPrivateKey: alice.privateKey,
  });
  const open = (changed: WrappedHistoryEpochKey) =>
    unwrapHistoryEpochKey({
      epochId: group.epoch.epochId,
      historyKeyVersion: 3,
      historyPrivateKey: history.privateKey,
      userId: "bob",
      wrappedEpochKey: changed,
    });

  test("opens the untouched wrap", () => {
    expect(open(wrap).expose()).toEqual(group.epochKey.expose());
  });

  test("rejects every single-bit change and every truncation of each field", () => {
    for (const field of ["wrappedKey", "ephemeralPublicKey", "senderPublicKey"] as const) {
      expect(
        openedVariants(
          [
            ...bitFlips(wrap[field]),
            ...everyBase64Truncation(wrap[field]),
            ...base64Extensions(wrap[field]),
          ],
          (value) => open({ ...wrap, [field]: value }),
        ),
      ).toEqual([]);
    }
  });
});

describe("History key escrow", () => {
  const recovery = deriveRecoveryKeyPair(generateRecoveryPhrase());
  const history = createHistoryKeyPair();
  const historyKey = {
    publicKey: history.publicKey,
    userId: "alice",
    version: 2,
  };
  const escrow = sealHistoryKeyEscrow({
    historyPrivateKey: history.privateKey,
    recoveryPrivateKey: recovery.privateKey,
    userId: "alice",
    version: 2,
  });
  const open = (changed: HistoryKeyEscrow) =>
    openHistoryKeyEscrow({
      escrow: changed,
      historyKey,
      recoveryPrivateKey: recovery.privateKey,
    });

  test("opens the untouched escrow", () => {
    expect(open(escrow).expose()).toEqual(history.privateKey.expose());
  });

  test("rejects every single-bit change and every truncation of the ciphertext and enc", () => {
    for (const field of ["ciphertext", "enc"] as const) {
      expect(
        openedVariants(
          [
            ...bitFlips(escrow[field]),
            ...everyBase64Truncation(escrow[field]),
            ...base64Extensions(escrow[field]),
          ],
          (value) => open({ ...escrow, [field]: value }),
        ),
      ).toEqual([]);
    }
  });
});

describe("personal data envelopes (nicknames, group colours, profile picture keys)", () => {
  const history = createHistoryKeyPair();
  const historyPrivateKeys = new Map([[4, history.privateKey]]);
  const binding = ["alice", "group-1", "bob"];
  const v3 = sealPersonalDataForHistoryKey({
    binding,
    historyKey: { publicKey: history.publicKey, version: 4 },
    plaintext: "Bobby 🚲",
    purpose: "nickname",
  });
  const v2 = sealPersonalData({
    binding,
    plaintext: "Bobby 🚲",
    privateKey: alice.privateKey,
    purpose: "nickname",
  });
  const envelope = (sealed: string) =>
    JSON.parse(sealed) as { ciphertext: string; enc: string; version: number };
  const openV3 = (sealed: string) =>
    openPersonalData({
      binding,
      historyPrivateKeys,
      purpose: "nickname",
      sealed,
    });
  const openV2 = (sealed: string) =>
    openPersonalData({
      binding,
      privateKey: alice.privateKey,
      purpose: "nickname",
      sealed,
    });

  test("opens the untouched envelopes", () => {
    expect(openV3(v3)).toBe("Bobby 🚲");
    expect(openV2(v2)).toBe("Bobby 🚲");
  });

  test("rejects every single-bit change and every truncation of the ciphertext and enc", () => {
    for (const [sealed, open] of [
      [v3, openV3],
      [v2, openV2],
    ] as const) {
      const parsed = envelope(sealed);
      for (const field of ["ciphertext", "enc"] as const) {
        expect(
          openedVariants(
            [
              ...bitFlips(parsed[field]),
              ...everyBase64Truncation(parsed[field]),
              ...base64Extensions(parsed[field]),
            ],
            (value) => open(JSON.stringify({ ...parsed, [field]: value })),
          ),
        ).toEqual([]);
      }
    }
  });

  test("rejects a changed envelope version or History key version", () => {
    const parsed = envelope(v3);
    expect(
      openedVariants(
        [
          { ...parsed, version: 2 },
          { ...parsed, version: 4 },
          { ...parsed, historyKeyVersion: 3 },
          { ...parsed, historyKeyVersion: 5 },
          { ...parsed, historyKeyVersion: 0 },
          { ...parsed, historyKeyVersion: -4 },
          { ...parsed, historyKeyVersion: 4.5 },
          { ...parsed, historyKeyVersion: "4" },
        ].map((changed) => JSON.stringify(changed)),
        openV3,
      ),
    ).toEqual([]);
  });

  test("rejects envelopes that aren't the documented JSON", () => {
    const parsed = envelope(v3);
    expect(
      openedVariants(
        [
          "",
          "null",
          "[]",
          "{}",
          v3.slice(0, -1),
          JSON.stringify({ ...parsed, ciphertext: undefined }),
          JSON.stringify({ ...parsed, enc: undefined }),
          JSON.stringify({ ...parsed, ciphertext: 7 }),
          JSON.stringify({ ...parsed, ciphertext: "" }),
        ],
        openV3,
      ),
    ).toEqual([]);
  });

  test("rejects a personal profile picture key changed in any bit", () => {
    const imageKey = generateImageKey();
    const sealed = sealProfileImageKey({
      fileName: "3f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f13",
      historyKey: { publicKey: history.publicKey, version: 4 },
      imageKey,
      userId: "alice",
    });
    const parsed = envelope(sealed);
    expect(
      openedVariants(bitFlips(parsed.ciphertext), (ciphertext) =>
        openProfileImageKey({
          fileName: "3f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f13",
          historyPrivateKeys,
          sealed: JSON.stringify({ ...parsed, ciphertext }),
          userId: "alice",
        }),
      ),
    ).toEqual([]);
  });
});

describe("encrypted pictures", () => {
  const context = {
    fileName: "3f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f13",
    ownerId: "group-1",
    purpose: "group-image",
  } as const;
  const picture = Uint8Array.from({ length: 48 }, (_, index) => (index * 37) % 256);
  const { blob, key } = encryptImage({ ...context, bytes: picture });
  const open = (changed: Uint8Array) => decryptImage({ ...context, blob: changed, key });

  test("opens the untouched blob", () => {
    expect(open(blob)).toEqual(picture);
  });

  test("rejects every single-bit change to the version byte, nonce, ciphertext and tag", () => {
    expect(openedVariants(everyBitFlip(blob), open)).toEqual([]);
  });

  test("rejects every truncation and extension", () => {
    expect(openedVariants([...everyTruncation(blob), ...extensions(blob)], open)).toEqual([]);
  });

  test("rejects a blob with its nonce and ciphertext swapped for another picture's", () => {
    const other = encryptImage({ ...context, bytes: picture });
    const spliced = Uint8Array.from([...blob.subarray(0, 25), ...other.blob.subarray(25)]);
    const splicedNonce = Uint8Array.from([...other.blob.subarray(0, 25), ...blob.subarray(25)]);
    expect(openedVariants([spliced, splicedNonce, other.blob], open)).toEqual([]);
  });
});

describe("encrypted picture keys", () => {
  const epochKey = generateGroupEpochKey();
  const context = {
    epochId: "epoch-1",
    fileName: "3f1c9a2e-7b4d-4e8a-9c1f-2a6b8d0e4f13",
    groupId: "group-1",
    kind: "group-image-key",
    ownerId: "group-1",
  } as const;
  const encryptedKey = encryptImageKey({
    ...context,
    epochKey,
    imageKey: generateImageKey(),
    senderDeviceId: "alice-phone",
  });

  test("rejects every single-bit change and every truncation of the ciphertext and nonce", () => {
    for (const field of ["ciphertext", "nonce"] as const) {
      expect(
        openedVariants(
          [
            ...bitFlips(encryptedKey[field]),
            ...everyBase64Truncation(encryptedKey[field]),
            ...base64Extensions(encryptedKey[field]),
          ],
          (value) =>
            decryptImageKey({
              ...context,
              encryptedKey: { ...encryptedKey, [field]: value },
              epochKey,
            }),
        ),
      ).toEqual([]);
    }
  });

  test("rejects every one-character change to the stored epoch and sender", () => {
    for (const field of ["epochId", "senderDeviceId"] as const) {
      expect(
        openedVariants(changeEachCharacter(encryptedKey[field]), (value) =>
          decryptImageKey({
            ...context,
            encryptedKey: { ...encryptedKey, [field]: value },
            epochKey,
          }),
        ),
      ).toEqual([]);
    }
  });
});

describe("device link handover", () => {
  const newDevice = createDeviceKeyPair();
  const historyKey = createHistoryKeyPair();
  const psk = createDeviceLinkSecret();
  const link = {
    linkId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    newDeviceId: "device-new",
    userId: "alice",
  };
  const sealed = sealDeviceLinkHandover({
    ...link,
    approverPrivateKey: alice.privateKey,
    historyKeys: [{ privateKey: historyKey.privateKey, version: 1 }],
    newDevicePublicKey: newDevice.publicKey,
    psk,
  });
  const open = (changed: { ciphertext: string; enc: string }, changedPsk = psk) =>
    openDeviceLinkHandover({
      ...link,
      approverPublicKey: alice.publicKey,
      currentHistoryKeyVersion: 1,
      devicePrivateKey: newDevice.privateKey,
      psk: changedPsk,
      publishedHistoryKeys: [{ publicKey: historyKey.publicKey, version: 1 }],
      sealed: changed,
    });

  test("opens the untouched handover", () => {
    expect(open(sealed)[0]?.privateKey.expose()).toEqual(historyKey.privateKey.expose());
  });

  test("rejects a change to any byte of the ciphertext or enc", () => {
    for (const field of ["ciphertext", "enc"] as const) {
      expect(
        openedVariants(
          [
            ...everyBase64ByteFlip(sealed[field]),
            ...everyBase64Truncation(sealed[field]),
            ...base64Extensions(sealed[field]),
          ],
          (value) => open({ ...sealed, [field]: value }),
        ),
      ).toEqual([]);
    }
  });

  test("rejects a QR secret that differs in any bit", () => {
    expect(openedVariants(everyBitFlip(psk), (changed) => open(sealed, changed))).toEqual([]);
  });
});

describe("session link and device activation challenges", () => {
  const challenge = Uint8Array.from({ length: 32 }, (_, index) => index);
  const history = createHistoryKeyPair();
  const sessionSealed = sealSessionLinkChallenge({
    challenge,
    deviceId: "alice-phone",
    devicePublicKey: alice.publicKey,
    userId: "alice",
  });
  const activationSealed = sealDeviceActivationChallenge({
    challenge,
    deviceId: "alice-phone",
    historyPublicKey: history.publicKey,
    userId: "alice",
  });

  test("reject a change to any byte of the ciphertext or enc", () => {
    for (const field of ["ciphertext", "enc"] as const) {
      expect(
        openedVariants(
          [
            ...everyBase64ByteFlip(sessionSealed[field]),
            ...everyBase64Truncation(sessionSealed[field]),
          ],
          (value) =>
            openSessionLinkChallenge({
              deviceId: "alice-phone",
              devicePrivateKey: alice.privateKey,
              sealed: { ...sessionSealed, [field]: value },
              userId: "alice",
            }),
        ),
      ).toEqual([]);
      expect(
        openedVariants(
          [
            ...everyBase64ByteFlip(activationSealed[field]),
            ...everyBase64Truncation(activationSealed[field]),
          ],
          (value) =>
            openDeviceActivationChallenge({
              deviceId: "alice-phone",
              historyPrivateKey: history.privateKey,
              sealed: { ...activationSealed, [field]: value },
              userId: "alice",
            }),
        ),
      ).toEqual([]);
    }
  });
});
