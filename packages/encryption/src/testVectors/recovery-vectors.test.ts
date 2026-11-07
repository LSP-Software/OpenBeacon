import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { openAuth, openBase } from "../hpke.ts";
import {
  DevicePrivateKeyMaterial,
  decodeBase64,
  deriveRecoveryKeyPair,
  EpochKeyMaterial,
  encodeBase64,
  HISTORY_ESCROW_ALGORITHM,
  HistoryPrivateKeyMaterial,
  openHistoryKeyEscrow,
  parseRecoveryPhrase,
  sealHistoryKeyEscrow,
  unwrapHistoryEpochKey,
  WRAPPED_EPOCH_KEY_ALGORITHM,
  wrapEpochKeyForHistoryKey,
} from "../index.ts";

const vectors = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "recovery-v1.json"), "utf8"),
) as {
  escrow: {
    ciphertextBase64: string;
    encBase64: string;
    ephemeralPrivateKeyHex: string;
    historyPrivateKeyHex: string;
    historyPublicKeyBase64: string;
    infoJson: string;
    userId: string;
    version: number;
  };
  historyWrap: {
    encBase64: string;
    ephemeralPrivateKeyHex: string;
    epochId: string;
    epochKeyHex: string;
    historyKeyVersion: number;
    infoJson: string;
    senderPrivateKeyHex: string;
    senderPublicKeyBase64: string;
    userId: string;
    wrappedKeyBase64: string;
  };
  recoveryKey: {
    entropyHex: string;
    info: string;
    phrase: string;
    privateKeyHex: string;
    publicKeyBase64: string;
    salt: string;
  };
  version: number;
};
const textEncoder = new TextEncoder();
const { escrow, historyWrap, recoveryKey } = vectors;

describe("recovery v1 vectors", () => {
  test("the recovery key is HKDF-SHA256 over the phrase entropy", () => {
    expect(vectors.version).toBe(1);
    expect(recoveryKey.salt).toBe("openbeacon.recovery.v1");
    expect(recoveryKey.info).toBe("recovery-key");

    const privateKey = hkdf(
      sha256,
      hexToBytes(recoveryKey.entropyHex),
      textEncoder.encode(recoveryKey.salt),
      textEncoder.encode(recoveryKey.info),
      32,
    );

    expect(bytesToHex(privateKey)).toBe(recoveryKey.privateKeyHex);
    expect(encodeBase64(x25519.getPublicKey(privateKey))).toBe(recoveryKey.publicKeyBase64);
  });

  test("derives the pinned recovery key from the phrase", () => {
    const keyPair = deriveRecoveryKeyPair(parseRecoveryPhrase(recoveryKey.phrase));

    expect(bytesToHex(keyPair.privateKey.expose())).toBe(recoveryKey.privateKeyHex);
    expect(keyPair.publicKey).toBe(recoveryKey.publicKeyBase64);
    expect(keyPair.derivationVersion).toBe(1);
  });

  test("seals the pinned escrow with the documented info", () => {
    const sealed = sealHistoryKeyEscrow({
      ephemeralPrivateKey: hexToBytes(escrow.ephemeralPrivateKeyHex),
      historyPrivateKey: new HistoryPrivateKeyMaterial(hexToBytes(escrow.historyPrivateKeyHex)),
      recoveryPublicKey: recoveryKey.publicKeyBase64,
      userId: escrow.userId,
      version: escrow.version,
    });

    expect(sealed).toEqual({
      algorithm: HISTORY_ESCROW_ALGORITHM,
      ciphertext: escrow.ciphertextBase64,
      enc: escrow.encBase64,
    });
    expect(
      bytesToHex(
        openBase({
          aad: new Uint8Array(),
          ciphertext: decodeBase64(escrow.ciphertextBase64),
          enc: decodeBase64(escrow.encBase64),
          info: textEncoder.encode(escrow.infoJson),
          recipientPrivateKey: hexToBytes(recoveryKey.privateKeyHex),
        }),
      ),
    ).toBe(escrow.historyPrivateKeyHex);
  });

  test("restores the pinned history key from the phrase and escrow", () => {
    const restored = openHistoryKeyEscrow({
      escrow: {
        algorithm: HISTORY_ESCROW_ALGORITHM,
        ciphertext: escrow.ciphertextBase64,
        enc: escrow.encBase64,
      },
      historyKey: {
        publicKey: escrow.historyPublicKeyBase64,
        userId: escrow.userId,
        version: escrow.version,
      },
      recoveryPrivateKey: deriveRecoveryKeyPair(parseRecoveryPhrase(recoveryKey.phrase)).privateKey,
    });

    expect(bytesToHex(restored.expose())).toBe(escrow.historyPrivateKeyHex);
  });

  test("wraps the pinned history wrap with the documented info", () => {
    const wrapped = wrapEpochKeyForHistoryKey({
      ephemeralPrivateKey: hexToBytes(historyWrap.ephemeralPrivateKeyHex),
      epochId: historyWrap.epochId,
      epochKey: new EpochKeyMaterial(hexToBytes(historyWrap.epochKeyHex)),
      historyKey: {
        publicKey: escrow.historyPublicKeyBase64,
        userId: historyWrap.userId,
        version: historyWrap.historyKeyVersion,
      },
      senderPrivateKey: new DevicePrivateKeyMaterial(hexToBytes(historyWrap.senderPrivateKeyHex)),
    });

    expect(wrapped).toEqual({
      algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
      ephemeralPublicKey: historyWrap.encBase64,
      epochId: historyWrap.epochId,
      historyKeyVersion: historyWrap.historyKeyVersion,
      senderPublicKey: historyWrap.senderPublicKeyBase64,
      userId: historyWrap.userId,
      wrappedKey: historyWrap.wrappedKeyBase64,
    });
    expect(
      bytesToHex(
        openAuth({
          aad: new Uint8Array(),
          ciphertext: decodeBase64(historyWrap.wrappedKeyBase64),
          enc: decodeBase64(historyWrap.encBase64),
          info: textEncoder.encode(historyWrap.infoJson),
          recipientPrivateKey: hexToBytes(escrow.historyPrivateKeyHex),
          senderPublicKey: decodeBase64(historyWrap.senderPublicKeyBase64),
        }),
      ),
    ).toBe(historyWrap.epochKeyHex);
  });

  test("unwraps the pinned history wrap", () => {
    const epochKey = unwrapHistoryEpochKey({
      epochId: historyWrap.epochId,
      historyKeyVersion: historyWrap.historyKeyVersion,
      historyPrivateKey: new HistoryPrivateKeyMaterial(hexToBytes(escrow.historyPrivateKeyHex)),
      userId: historyWrap.userId,
      wrappedEpochKey: {
        algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
        ephemeralPublicKey: historyWrap.encBase64,
        senderPublicKey: historyWrap.senderPublicKeyBase64,
        wrappedKey: historyWrap.wrappedKeyBase64,
      },
    });

    expect(bytesToHex(epochKey.expose())).toBe(historyWrap.epochKeyHex);
  });
});
