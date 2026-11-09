import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { decodeBase64, encodeBase64 } from "./base64.ts";
import {
  DEVICE_KEY_ALGORITHM,
  GROUP_EPOCH_DOMAIN_CONTEXT,
  GROUP_EPOCH_KEY_LENGTH,
  HISTORY_ESCROW_ALGORITHM,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  RECOVERY_KEY_DERIVATION_VERSION,
  WRAPPED_EPOCH_KEY_ALGORITHM,
  X25519_KEY_ALGORITHM,
  XCHACHA20_NONCE_LENGTH,
} from "./constants.ts";
import { openAuth, sealAuth } from "./hpke.ts";
import {
  DevicePrivateKeyMaterial,
  EpochKeyMaterial,
  HistoryPrivateKeyMaterial,
  RecoveryPhrase,
  RecoveryPrivateKeyMaterial,
  SensitivePayloadBytes,
} from "./sensitive.ts";
import type { TrackingPointV1 } from "./trackingPoint.ts";
import {
  encodeTrackingPointV1,
  TRACKING_POINT_KIND,
  validateTrackingPointV1,
} from "./trackingPoint.ts";
import type {
  DecryptedGroupPayload,
  DeviceKeyPair,
  EncryptedPayload,
  EpochCreator,
  GroupEpoch,
  GroupEpochCreationResult,
  GroupPayloadKind,
  HistoryKeyEscrow,
  HistoryPublicKey,
  PersonalDataPurpose,
  RecipientPublicKeyMaterial,
  WrappedEpochKey,
  WrappedHistoryEpochKey,
} from "./types.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const createOpaqueId = (prefix: string) => {
  const bytes = randomBytes(16);
  return `${prefix}_${encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")}`;
};

const encodeMetadata = (metadata: Record<string, string>) =>
  textEncoder.encode(JSON.stringify(metadata));

const ensureEpochKeyLength = (bytes: Uint8Array) => {
  if (bytes.length !== GROUP_EPOCH_KEY_LENGTH) {
    throw new Error("Invalid epoch key length.");
  }
};

const getWrapInfo = (epochId: string, recipientDeviceId: string) =>
  encodeMetadata({
    context: GROUP_EPOCH_DOMAIN_CONTEXT,
    epochId,
    purpose: "epoch-key-wrap",
    recipientDeviceId,
  });

const getPayloadAssociatedData = (
  groupId: string,
  epochId: string,
  kind: GroupPayloadKind,
  senderDeviceId: string,
) =>
  encodeMetadata({
    context: GROUP_EPOCH_DOMAIN_CONTEXT,
    epochId,
    groupId,
    kind,
    purpose: "payload",
    senderDeviceId,
  });

const assertMetadataMatch = (
  encryptedPayload: EncryptedPayload,
  expectedMetadata: Pick<EncryptedPayload, "epochId" | "groupId" | "kind" | "senderDeviceId">,
) => {
  if (
    encryptedPayload.groupId !== expectedMetadata.groupId ||
    encryptedPayload.epochId !== expectedMetadata.epochId ||
    encryptedPayload.kind !== expectedMetadata.kind ||
    encryptedPayload.senderDeviceId !== expectedMetadata.senderDeviceId
  ) {
    throw new Error("Encrypted payload metadata mismatch.");
  }
};

const encodePayload = (payload: Record<string, unknown> | Uint8Array) => {
  if (payload instanceof Uint8Array) {
    return payload;
  }

  return textEncoder.encode(JSON.stringify(payload));
};

/**
 * Public keys are safe to persist server-side. Private keys are wrapped in a redacted container and
 * must only be stored locally in platform secure storage.
 */
export const createDeviceKeyPair = (): DeviceKeyPair => {
  const keyPair = x25519.keygen();

  return {
    algorithm: DEVICE_KEY_ALGORITHM,
    privateKey: new DevicePrivateKeyMaterial(keyPair.secretKey),
    publicKey: encodeBase64(keyPair.publicKey),
  };
};

export const isUsableX25519PublicKey = (publicKey: Uint8Array): boolean => {
  try {
    x25519.getSharedSecret(new Uint8Array(32), publicKey);
    return true;
  } catch {
    return false;
  }
};

export const serializeRecipientPublicKeyMaterial = ({
  algorithm,
  createdAt,
  deviceId,
  publicKey,
  revokedAt,
  userId,
}: {
  algorithm: string;
  createdAt: Date | string;
  deviceId: string;
  publicKey: string;
  revokedAt: Date | null | string;
  userId: string;
}): RecipientPublicKeyMaterial => {
  if (algorithm !== DEVICE_KEY_ALGORITHM) {
    throw new Error("Unsupported recipient public key algorithm.");
  }

  return {
    algorithm: DEVICE_KEY_ALGORITHM,
    createdAt: createdAt instanceof Date ? createdAt : new Date(createdAt),
    deviceId,
    publicKey,
    revokedAt:
      revokedAt === null ? null : revokedAt instanceof Date ? revokedAt : new Date(revokedAt),
    userId,
  };
};

export const generateGroupEpochKey = () =>
  new EpochKeyMaterial(randomBytes(GROUP_EPOCH_KEY_LENGTH));

export const wrapEpochKeyForRecipient = ({
  epoch,
  epochKey,
  recipient,
  senderPrivateKey,
}: {
  epoch: GroupEpoch;
  epochKey: EpochKeyMaterial;
  recipient: RecipientPublicKeyMaterial;
  senderPrivateKey: DevicePrivateKeyMaterial;
}): WrappedEpochKey => {
  const senderPrivateKeyBytes = senderPrivateKey.expose();
  const sealed = sealAuth({
    aad: new Uint8Array(),
    info: getWrapInfo(epoch.epochId, recipient.deviceId),
    plaintext: epochKey.expose(),
    recipientPublicKey: decodeBase64(recipient.publicKey),
    senderPrivateKey: senderPrivateKeyBytes,
  });

  return {
    algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
    createdAt: new Date(),
    ephemeralPublicKey: encodeBase64(sealed.enc),
    epochId: epoch.epochId,
    recipientDeviceId: recipient.deviceId,
    senderPublicKey: encodeBase64(x25519.getPublicKey(senderPrivateKeyBytes)),
    wrappedKey: encodeBase64(sealed.ciphertext),
  };
};

export const wrapEpochKeyForRecipients = ({
  epoch,
  epochKey,
  recipients,
  senderPrivateKey,
}: {
  epoch: GroupEpoch;
  epochKey: EpochKeyMaterial;
  recipients: RecipientPublicKeyMaterial[];
  senderPrivateKey: DevicePrivateKeyMaterial;
}) =>
  recipients
    .slice()
    .sort((left, right) => left.deviceId.localeCompare(right.deviceId))
    .map((recipient) => wrapEpochKeyForRecipient({ epoch, epochKey, recipient, senderPrivateKey }));

export const unwrapEpochKey = ({
  recipientDeviceId,
  recipientPrivateKey,
  wrappedEpochKey,
}: {
  recipientDeviceId: string;
  recipientPrivateKey: DevicePrivateKeyMaterial;
  wrappedEpochKey: WrappedEpochKey;
}) => {
  if (wrappedEpochKey.algorithm !== WRAPPED_EPOCH_KEY_ALGORITHM) {
    throw new Error("Unsupported wrapped epoch key algorithm.");
  }

  if (wrappedEpochKey.recipientDeviceId !== recipientDeviceId) {
    throw new Error("Wrapped epoch key recipient mismatch.");
  }

  const epochKeyBytes = openAuth({
    aad: new Uint8Array(),
    ciphertext: decodeBase64(wrappedEpochKey.wrappedKey),
    enc: decodeBase64(wrappedEpochKey.ephemeralPublicKey),
    info: getWrapInfo(wrappedEpochKey.epochId, wrappedEpochKey.recipientDeviceId),
    recipientPrivateKey: recipientPrivateKey.expose(),
    senderPublicKey: decodeBase64(wrappedEpochKey.senderPublicKey),
  });

  ensureEpochKeyLength(epochKeyBytes);

  return new EpochKeyMaterial(epochKeyBytes);
};

export const encryptPayloadWithEpochKey = ({
  epochKey,
  plaintext,
  metadata,
  nonce: providedNonce,
}: {
  epochKey: EpochKeyMaterial;
  metadata: Pick<EncryptedPayload, "epochId" | "groupId" | "kind" | "senderDeviceId">;
  nonce?: Uint8Array;
  plaintext: Uint8Array;
}): EncryptedPayload => {
  const epochKeyBytes = epochKey.expose();

  ensureEpochKeyLength(epochKeyBytes);

  const nonce = providedNonce ?? randomBytes(XCHACHA20_NONCE_LENGTH);

  if (nonce.length !== XCHACHA20_NONCE_LENGTH) {
    throw new Error("Invalid nonce length.");
  }

  const cipher = xchacha20poly1305(
    epochKeyBytes,
    nonce,
    getPayloadAssociatedData(
      metadata.groupId,
      metadata.epochId,
      metadata.kind,
      metadata.senderDeviceId,
    ),
  );

  return {
    algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
    ciphertext: encodeBase64(cipher.encrypt(plaintext)),
    createdAt: new Date(),
    epochId: metadata.epochId,
    groupId: metadata.groupId,
    kind: metadata.kind,
    nonce: encodeBase64(nonce),
    senderDeviceId: metadata.senderDeviceId,
  };
};

export const decryptPayloadWithEpochKey = ({
  encryptedPayload,
  epochKey,
  expectedMetadata,
}: {
  encryptedPayload: EncryptedPayload;
  epochKey: EpochKeyMaterial;
  expectedMetadata: Pick<EncryptedPayload, "epochId" | "groupId" | "kind" | "senderDeviceId">;
}): DecryptedGroupPayload => {
  assertMetadataMatch(encryptedPayload, expectedMetadata);

  const epochKeyBytes = epochKey.expose();
  ensureEpochKeyLength(epochKeyBytes);

  const cipher = xchacha20poly1305(
    epochKeyBytes,
    decodeBase64(encryptedPayload.nonce),
    getPayloadAssociatedData(
      encryptedPayload.groupId,
      encryptedPayload.epochId,
      encryptedPayload.kind,
      encryptedPayload.senderDeviceId,
    ),
  );

  return {
    bytes: new SensitivePayloadBytes(cipher.decrypt(decodeBase64(encryptedPayload.ciphertext))),
    metadata: expectedMetadata,
  };
};

/**
 * The caller chooses the blob kind. This module only handles authenticated encryption and does not
 * assume the payload is location-specific.
 */
export const encryptGroupPayload = ({
  epochKey,
  groupId,
  kind,
  payload,
  senderDeviceId,
  epochId,
  nonce,
}: {
  epochId: string;
  epochKey: EpochKeyMaterial;
  groupId: string;
  kind: GroupPayloadKind;
  nonce?: Uint8Array;
  payload: Record<string, unknown> | Uint8Array;
  senderDeviceId: string;
}) =>
  encryptPayloadWithEpochKey({
    epochKey,
    metadata: {
      epochId,
      groupId,
      kind,
      senderDeviceId,
    },
    plaintext: encodePayload(payload),
    ...(nonce === undefined ? {} : { nonce }),
  });

export const decryptGroupPayload = ({
  encryptedPayload,
  epochKey,
  expectedMetadata,
}: {
  encryptedPayload: EncryptedPayload;
  epochKey: EpochKeyMaterial;
  expectedMetadata: Pick<EncryptedPayload, "epochId" | "groupId" | "kind" | "senderDeviceId">;
}) => decryptPayloadWithEpochKey({ encryptedPayload, epochKey, expectedMetadata });

export const decodeJsonPayload = <T>(payload: SensitivePayloadBytes) =>
  JSON.parse(textDecoder.decode(payload.expose())) as T;

export const decodeUtf8Payload = (payload: SensitivePayloadBytes) =>
  textDecoder.decode(payload.expose());

export const createInitialGroupEpoch = ({
  creator,
  groupId,
  recipients,
}: {
  creator: EpochCreator;
  groupId: string;
  recipients: RecipientPublicKeyMaterial[];
}): GroupEpochCreationResult => {
  const epoch = {
    createdAt: new Date(),
    createdByDeviceId: creator.deviceId,
    epochId: createOpaqueId("epoch"),
    epochNumber: 1,
    groupId,
  } satisfies GroupEpoch;
  const epochKey = generateGroupEpochKey();

  return {
    epoch,
    epochKey,
    wrappedKeys: wrapEpochKeyForRecipients({
      epoch,
      epochKey,
      recipients,
      senderPrivateKey: creator.privateKey,
    }),
  };
};

export const createNextGroupEpoch = ({
  creator,
  previousEpoch,
  recipients,
}: {
  creator: EpochCreator;
  previousEpoch: GroupEpoch;
  recipients: RecipientPublicKeyMaterial[];
}): GroupEpochCreationResult => {
  const epoch = {
    createdAt: new Date(),
    createdByDeviceId: creator.deviceId,
    epochId: createOpaqueId("epoch"),
    epochNumber: previousEpoch.epochNumber + 1,
    groupId: previousEpoch.groupId,
  } satisfies GroupEpoch;
  const epochKey = generateGroupEpochKey();

  return {
    epoch,
    epochKey,
    wrappedKeys: wrapEpochKeyForRecipients({
      epoch,
      epochKey,
      recipients,
      senderPrivateKey: creator.privateKey,
    }),
  };
};

export const getRecordEpochId = <T extends { epochId: string }>(record: T) => record.epochId;

export {
  decodeBase64,
  DEVICE_KEY_ALGORITHM,
  DevicePrivateKeyMaterial,
  encodeBase64,
  encodeTrackingPointV1,
  EpochKeyMaterial,
  HISTORY_ESCROW_ALGORITHM,
  HistoryPrivateKeyMaterial,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  RECOVERY_KEY_DERIVATION_VERSION,
  RecoveryPhrase,
  RecoveryPrivateKeyMaterial,
  SensitivePayloadBytes,
  TRACKING_POINT_KIND,
  validateTrackingPointV1,
  WRAPPED_EPOCH_KEY_ALGORITHM,
  X25519_KEY_ALGORITHM,
  XCHACHA20_NONCE_LENGTH,
};
export type {
  DecryptedGroupPayload,
  DeviceKeyPair,
  EncryptedPayload,
  EpochCreator,
  GroupEpoch,
  GroupEpochCreationResult,
  GroupPayloadKind,
  HistoryKeyEscrow,
  HistoryPublicKey,
  PersonalDataPurpose,
  RecipientPublicKeyMaterial,
  TrackingPointV1,
  WrappedEpochKey,
  WrappedHistoryEpochKey,
};

export {
  getPersonalDataHistoryKeyVersion,
  openPersonalData,
  sealPersonalData,
  sealPersonalDataForHistoryKey,
} from "./personalData.ts";
export {
  createHistoryKeyPair,
  deriveRecoveryKeyPair,
  diagnoseRecoveryPhraseInput,
  generateRecoveryPhrase,
  getHistoryPublicKey,
  openHistoryKeyEscrow,
  parseRecoveryPhrase,
  sealHistoryKeyEscrow,
  unwrapHistoryEpochKey,
  wrapEpochKeyForHistoryKey,
} from "./recovery.ts";
