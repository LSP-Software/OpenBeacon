import type {
  DEVICE_KEY_ALGORITHM,
  HISTORY_ESCROW_ALGORITHM,
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
  createdByDeviceId: string | null;
  epochId: string;
  epochNumber: number;
  groupId: string;
};

export type EpochCreator = {
  deviceId: string;
  privateKey: DevicePrivateKeyMaterial;
};

export type WrappedEpochKey = {
  algorithm: typeof WRAPPED_EPOCH_KEY_ALGORITHM;
  createdAt: Date;
  ephemeralPublicKey: string;
  epochId: string;
  recipientDeviceId: string;
  senderPublicKey: string;
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

export type PersonalDataPurpose = "nickname" | "group-color";

export type HistoryPublicKey = {
  publicKey: string;
  userId: string;
  version: number;
};

export type HistoryKeyEscrow = {
  algorithm: typeof HISTORY_ESCROW_ALGORITHM;
  ciphertext: string;
  enc: string;
};

export type WrappedHistoryEpochKey = {
  algorithm: typeof WRAPPED_EPOCH_KEY_ALGORITHM;
  ephemeralPublicKey: string;
  epochId: string;
  historyKeyVersion: number;
  senderPublicKey: string;
  userId: string;
  wrappedKey: string;
};
