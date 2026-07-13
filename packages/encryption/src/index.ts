import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { decodeBase64, encodeBase64 } from "./base64.ts";
import {
  DEVICE_KEY_ALGORITHM,
  GROUP_EPOCH_KEY_LENGTH,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  WRAPPED_EPOCH_KEY_ALGORITHM,
  XCHACHA20_NONCE_LENGTH,
} from "./constants.ts";
import { DevicePrivateKeyMaterial, EpochKeyMaterial, SensitivePayloadBytes } from "./sensitive.ts";
import type {
  DecryptedGroupPayload,
  DeviceKeyPair,
  EncryptedPayload,
  GroupEpoch,
  GroupEpochCreationResult,
  GroupPayloadKind,
  RecipientPublicKeyMaterial,
  WrappedEpochKey,
} from "./types.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const DOMAIN_CONTEXT = "openbeacon.group-epoch.v1";

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

const getWrapAssociatedData = (epochId: string, recipientDeviceId: string) =>
  encodeMetadata({
    context: DOMAIN_CONTEXT,
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
    context: DOMAIN_CONTEXT,
    epochId,
    groupId,
    kind,
    purpose: "payload",
    senderDeviceId,
  });

const deriveEpochKeyEncryptionKey = (
  sharedSecret: Uint8Array,
  epochId: string,
  recipientDeviceId: string,
) =>
  hkdf(
    sha256,
    sharedSecret,
    undefined,
    encodeMetadata({
      context: DOMAIN_CONTEXT,
      epochId,
      purpose: "epoch-key-kek",
      recipientDeviceId,
    }),
    GROUP_EPOCH_KEY_LENGTH,
  );

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
}: {
  epoch: GroupEpoch;
  epochKey: EpochKeyMaterial;
  recipient: RecipientPublicKeyMaterial;
}): WrappedEpochKey => {
  const ephemeralKeyPair = x25519.keygen();
  const sharedSecret = x25519.getSharedSecret(
    ephemeralKeyPair.secretKey,
    decodeBase64(recipient.publicKey),
  );
  const keyEncryptionKey = deriveEpochKeyEncryptionKey(
    sharedSecret,
    epoch.epochId,
    recipient.deviceId,
  );
  const nonce = randomBytes(XCHACHA20_NONCE_LENGTH);
  const cipher = xchacha20poly1305(
    keyEncryptionKey,
    nonce,
    getWrapAssociatedData(epoch.epochId, recipient.deviceId),
  );

  return {
    algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
    createdAt: new Date(),
    ephemeralPublicKey: encodeBase64(ephemeralKeyPair.publicKey),
    epochId: epoch.epochId,
    nonce: encodeBase64(nonce),
    recipientDeviceId: recipient.deviceId,
    wrappedKey: encodeBase64(cipher.encrypt(epochKey.expose())),
  };
};

export const wrapEpochKeyForRecipients = ({
  epoch,
  epochKey,
  recipients,
}: {
  epoch: GroupEpoch;
  epochKey: EpochKeyMaterial;
  recipients: RecipientPublicKeyMaterial[];
}) =>
  recipients
    .slice()
    .sort((left, right) => left.deviceId.localeCompare(right.deviceId))
    .map((recipient) => wrapEpochKeyForRecipient({ epoch, epochKey, recipient }));

export const unwrapEpochKey = ({
  recipientDeviceId,
  recipientPrivateKey,
  wrappedEpochKey,
}: {
  recipientDeviceId: string;
  recipientPrivateKey: DevicePrivateKeyMaterial;
  wrappedEpochKey: WrappedEpochKey;
}) => {
  if (wrappedEpochKey.recipientDeviceId !== recipientDeviceId) {
    throw new Error("Wrapped epoch key recipient mismatch.");
  }

  const sharedSecret = x25519.getSharedSecret(
    recipientPrivateKey.expose(),
    decodeBase64(wrappedEpochKey.ephemeralPublicKey),
  );
  const keyEncryptionKey = deriveEpochKeyEncryptionKey(
    sharedSecret,
    wrappedEpochKey.epochId,
    wrappedEpochKey.recipientDeviceId,
  );
  const cipher = xchacha20poly1305(
    keyEncryptionKey,
    decodeBase64(wrappedEpochKey.nonce),
    getWrapAssociatedData(wrappedEpochKey.epochId, wrappedEpochKey.recipientDeviceId),
  );
  const epochKeyBytes = cipher.decrypt(decodeBase64(wrappedEpochKey.wrappedKey));

  ensureEpochKeyLength(epochKeyBytes);

  return new EpochKeyMaterial(epochKeyBytes);
};

export const encryptPayloadWithEpochKey = ({
  epochKey,
  plaintext,
  metadata,
}: {
  epochKey: EpochKeyMaterial;
  metadata: Pick<EncryptedPayload, "epochId" | "groupId" | "kind" | "senderDeviceId">;
  plaintext: Uint8Array;
}): EncryptedPayload => {
  const epochKeyBytes = epochKey.expose();

  ensureEpochKeyLength(epochKeyBytes);

  const nonce = randomBytes(XCHACHA20_NONCE_LENGTH);
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
}: {
  epochId: string;
  epochKey: EpochKeyMaterial;
  groupId: string;
  kind: GroupPayloadKind;
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
  createdByDeviceId,
  groupId,
  recipients,
}: {
  createdByDeviceId: string;
  groupId: string;
  recipients: RecipientPublicKeyMaterial[];
}): GroupEpochCreationResult => {
  const epoch = {
    createdAt: new Date(),
    createdByDeviceId,
    epochId: createOpaqueId("epoch"),
    epochNumber: 1,
    groupId,
  } satisfies GroupEpoch;
  const epochKey = generateGroupEpochKey();

  return {
    epoch,
    epochKey,
    wrappedKeys: wrapEpochKeyForRecipients({ epoch, epochKey, recipients }),
  };
};

export const createNextGroupEpoch = ({
  createdByDeviceId,
  previousEpoch,
  recipients,
}: {
  createdByDeviceId: string;
  previousEpoch: GroupEpoch;
  recipients: RecipientPublicKeyMaterial[];
}): GroupEpochCreationResult => {
  const epoch = {
    createdAt: new Date(),
    createdByDeviceId,
    epochId: createOpaqueId("epoch"),
    epochNumber: previousEpoch.epochNumber + 1,
    groupId: previousEpoch.groupId,
  } satisfies GroupEpoch;
  const epochKey = generateGroupEpochKey();

  return {
    epoch,
    epochKey,
    wrappedKeys: wrapEpochKeyForRecipients({ epoch, epochKey, recipients }),
  };
};

export const getRecordEpochId = <T extends { epochId: string }>(record: T) => record.epochId;

export {
  decodeBase64,
  DEVICE_KEY_ALGORITHM,
  DevicePrivateKeyMaterial,
  encodeBase64,
  EpochKeyMaterial,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  SensitivePayloadBytes,
  WRAPPED_EPOCH_KEY_ALGORITHM,
  XCHACHA20_NONCE_LENGTH,
};
export type {
  DecryptedGroupPayload,
  DeviceKeyPair,
  EncryptedPayload,
  GroupEpoch,
  GroupEpochCreationResult,
  GroupPayloadKind,
  RecipientPublicKeyMaterial,
  WrappedEpochKey,
};
