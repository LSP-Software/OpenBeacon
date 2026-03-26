import type {
  DEVICE_KEY_ALGORITHM,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  WRAPPED_EPOCH_KEY_ALGORITHM,
} from "./constants.ts";
import type {
  DevicePrivateKeyMaterial,
  EpochKeyMaterial,
  SensitivePayloadBytes,
} from "./sensitive.ts";

export type GroupPayloadKind = string;

export type RecipientPublicKeyMaterial = {
  algorithm: typeof DEVICE_KEY_ALGORITHM;
  createdAt: Date;
  deviceId: string;
  publicKey: string;
  revokedAt: Date | null;
  userId: string;
};

export type DeviceKeyPair = {
  algorithm: typeof DEVICE_KEY_ALGORITHM;
  privateKey: DevicePrivateKeyMaterial;
  publicKey: string;
};

export type GroupEpoch = {
  createdAt: Date;
  createdByDeviceId: string;
  epochId: string;
  epochNumber: number;
  groupId: string;
};

export type WrappedEpochKey = {
  algorithm: typeof WRAPPED_EPOCH_KEY_ALGORITHM;
  createdAt: Date;
  ephemeralPublicKey: string;
  epochId: string;
  nonce: string;
  recipientDeviceId: string;
  wrappedKey: string;
};

export type EncryptedPayload = {
  algorithm: typeof PAYLOAD_ENCRYPTION_ALGORITHM;
  ciphertext: string;
  createdAt: Date;
  epochId: string;
  groupId: string;
  kind: GroupPayloadKind;
  nonce: string;
  senderDeviceId: string;
};

export type GroupEpochCreationResult = {
  epoch: GroupEpoch;
  epochKey: EpochKeyMaterial;
  wrappedKeys: WrappedEpochKey[];
};

export type DecryptedGroupPayload = {
  bytes: SensitivePayloadBytes;
  metadata: Pick<EncryptedPayload, "epochId" | "groupId" | "kind" | "senderDeviceId">;
};
