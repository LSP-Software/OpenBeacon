import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { generateMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { decodeBase64, encodeBase64 } from "./base64.ts";
import {
  GROUP_EPOCH_KEY_LENGTH,
  HISTORY_ESCROW_ALGORITHM,
  RECOVERY_KEY_DERIVATION_VERSION,
  WRAPPED_EPOCH_KEY_ALGORITHM,
  X25519_KEY_ALGORITHM,
} from "./constants.ts";
import { openAuth, openBase, sealAuth, sealBase } from "./hpke.ts";
import {
  type DevicePrivateKeyMaterial,
  EpochKeyMaterial,
  HistoryPrivateKeyMaterial,
  RecoveryPhrase,
  RecoveryPrivateKeyMaterial,
} from "./sensitive.ts";
import type { HistoryKeyEscrow, HistoryPublicKey, WrappedHistoryEpochKey } from "./types.ts";

const textEncoder = new TextEncoder();
const X25519_PRIVATE_KEY_LENGTH = 32;

const getEscrowInfo = (userId: string, version: number) =>
  textEncoder.encode(JSON.stringify(["openbeacon.history-escrow.v1", userId, version]));

const getHistoryWrapInfo = (epochId: string, userId: string, historyKeyVersion: number) =>
  textEncoder.encode(
    JSON.stringify({
      context: "openbeacon.group-epoch.v1",
      epochId,
      historyKeyVersion,
      purpose: "epoch-key-history-wrap",
      userId,
    }),
  );

export const generateRecoveryPhrase = () =>
  new RecoveryPhrase(textEncoder.encode(generateMnemonic(wordlist, 128)));

export const parseRecoveryPhrase = (input: string) => {
  const normalized = input.normalize("NFKD").toLowerCase().trim().split(/\s+/).join(" ");

  if (normalized.split(" ").length !== 12 || !validateMnemonic(normalized, wordlist)) {
    throw new Error("Invalid recovery phrase.");
  }

  return new RecoveryPhrase(textEncoder.encode(normalized));
};

export const deriveRecoveryKeyPair = (phrase: RecoveryPhrase) => {
  const entropy = mnemonicToEntropy(new TextDecoder().decode(phrase.expose()), wordlist);
  const privateKey = hkdf(
    sha256,
    entropy,
    textEncoder.encode("openbeacon.recovery.v1"),
    textEncoder.encode("recovery-key"),
    X25519_PRIVATE_KEY_LENGTH,
  );

  return {
    algorithm: X25519_KEY_ALGORITHM,
    derivationVersion: RECOVERY_KEY_DERIVATION_VERSION,
    privateKey: new RecoveryPrivateKeyMaterial(privateKey),
    publicKey: encodeBase64(x25519.getPublicKey(privateKey)),
  };
};

export const createHistoryKeyPair = () => {
  const keyPair = x25519.keygen();

  return {
    algorithm: X25519_KEY_ALGORITHM,
    privateKey: new HistoryPrivateKeyMaterial(keyPair.secretKey),
    publicKey: encodeBase64(keyPair.publicKey),
  };
};

export const getHistoryPublicKey = (privateKey: HistoryPrivateKeyMaterial) =>
  encodeBase64(x25519.getPublicKey(privateKey.expose()));

export const sealHistoryKeyEscrow = ({
  ephemeralPrivateKey,
  historyPrivateKey,
  recoveryPublicKey,
  userId,
  version,
}: {
  ephemeralPrivateKey?: Uint8Array;
  historyPrivateKey: HistoryPrivateKeyMaterial;
  recoveryPublicKey: string;
  userId: string;
  version: number;
}): HistoryKeyEscrow => {
  const sealed = sealBase({
    aad: new Uint8Array(),
    info: getEscrowInfo(userId, version),
    plaintext: historyPrivateKey.expose(),
    recipientPublicKey: decodeBase64(recoveryPublicKey),
    ...(ephemeralPrivateKey === undefined ? {} : { ephemeralPrivateKey }),
  });

  return {
    algorithm: HISTORY_ESCROW_ALGORITHM,
    ciphertext: encodeBase64(sealed.ciphertext),
    enc: encodeBase64(sealed.enc),
  };
};

export const openHistoryKeyEscrow = ({
  escrow,
  historyKey,
  recoveryPrivateKey,
}: {
  escrow: HistoryKeyEscrow;
  historyKey: HistoryPublicKey;
  recoveryPrivateKey: RecoveryPrivateKeyMaterial;
}) => {
  if (escrow.algorithm !== HISTORY_ESCROW_ALGORITHM) {
    throw new Error("Unsupported history key escrow algorithm.");
  }

  const privateKey = new HistoryPrivateKeyMaterial(
    openBase({
      aad: new Uint8Array(),
      ciphertext: decodeBase64(escrow.ciphertext),
      enc: decodeBase64(escrow.enc),
      info: getEscrowInfo(historyKey.userId, historyKey.version),
      recipientPrivateKey: recoveryPrivateKey.expose(),
    }),
  );

  if (
    privateKey.expose().length !== X25519_PRIVATE_KEY_LENGTH ||
    getHistoryPublicKey(privateKey) !== historyKey.publicKey
  ) {
    throw new Error("Recovery data doesn't match.");
  }

  return privateKey;
};

export const wrapEpochKeyForHistoryKey = ({
  ephemeralPrivateKey,
  epochId,
  epochKey,
  historyKey,
  senderPrivateKey,
}: {
  ephemeralPrivateKey?: Uint8Array;
  epochId: string;
  epochKey: EpochKeyMaterial;
  historyKey: HistoryPublicKey;
  senderPrivateKey: DevicePrivateKeyMaterial;
}): WrappedHistoryEpochKey => {
  const senderPrivateKeyBytes = senderPrivateKey.expose();
  const sealed = sealAuth({
    aad: new Uint8Array(),
    info: getHistoryWrapInfo(epochId, historyKey.userId, historyKey.version),
    plaintext: epochKey.expose(),
    recipientPublicKey: decodeBase64(historyKey.publicKey),
    senderPrivateKey: senderPrivateKeyBytes,
    ...(ephemeralPrivateKey === undefined ? {} : { ephemeralPrivateKey }),
  });

  return {
    algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
    ephemeralPublicKey: encodeBase64(sealed.enc),
    epochId,
    historyKeyVersion: historyKey.version,
    senderPublicKey: encodeBase64(x25519.getPublicKey(senderPrivateKeyBytes)),
    userId: historyKey.userId,
    wrappedKey: encodeBase64(sealed.ciphertext),
  };
};

export const unwrapHistoryEpochKey = ({
  epochId,
  historyKeyVersion,
  historyPrivateKey,
  userId,
  wrappedEpochKey,
}: {
  epochId: string;
  historyKeyVersion: number;
  historyPrivateKey: HistoryPrivateKeyMaterial;
  userId: string;
  wrappedEpochKey: Pick<
    WrappedHistoryEpochKey,
    "algorithm" | "ephemeralPublicKey" | "senderPublicKey" | "wrappedKey"
  >;
}) => {
  if (wrappedEpochKey.algorithm !== WRAPPED_EPOCH_KEY_ALGORITHM) {
    throw new Error("Unsupported wrapped epoch key algorithm.");
  }

  const epochKeyBytes = openAuth({
    aad: new Uint8Array(),
    ciphertext: decodeBase64(wrappedEpochKey.wrappedKey),
    enc: decodeBase64(wrappedEpochKey.ephemeralPublicKey),
    info: getHistoryWrapInfo(epochId, userId, historyKeyVersion),
    recipientPrivateKey: historyPrivateKey.expose(),
    senderPublicKey: decodeBase64(wrappedEpochKey.senderPublicKey),
  });

  if (epochKeyBytes.length !== GROUP_EPOCH_KEY_LENGTH) {
    throw new Error("Invalid epoch key length.");
  }

  return new EpochKeyMaterial(epochKeyBytes);
};
