import {
  decodeBase64,
  HISTORY_ESCROW_ALGORITHM,
  isUsableX25519PublicKey,
  RECOVERY_KEY_DERIVATION_VERSION,
  X25519_KEY_ALGORITHM,
} from "@openbeacon/encryption";
import z from "zod";
import {
  encodedBytes,
  historyKeyVersionSchema,
  wrappedHistoryEpochKeySchema,
} from "./registerDeviceKey.ts";

const x25519PublicKeySchema = encodedBytes(32).refine(
  (publicKey) => isUsableX25519PublicKey(decodeBase64(publicKey)),
  "Invalid public key.",
);

const historyKeyEscrowFields = {
  algorithm: z.literal(HISTORY_ESCROW_ALGORITHM),
  ciphertext: encodedBytes(48),
  enc: x25519PublicKeySchema,
};

const recoveryKeySchema = z.strictObject({
  algorithm: z.literal(X25519_KEY_ALGORITHM),
  derivationVersion: z.literal(RECOVERY_KEY_DERIVATION_VERSION),
  publicKey: x25519PublicKeySchema,
});

const newHistoryKeySchema = z.strictObject({
  algorithm: z.literal(X25519_KEY_ALGORITHM),
  escrow: z.strictObject(historyKeyEscrowFields),
  id: z.uuid(),
  publicKey: x25519PublicKeySchema,
  version: historyKeyVersionSchema,
});

export const setupAccountRecoverySchema = z.strictObject({
  historyKey: newHistoryKeySchema,
  recoveryKey: recoveryKeySchema,
});

export const changeRecoveryPhraseSchema = z.strictObject({
  escrows: z
    .array(z.strictObject({ ...historyKeyEscrowFields, version: historyKeyVersionSchema }))
    .min(1)
    .max(1000),
  recoveryKey: recoveryKeySchema,
});

export const resetAccountRecoverySchema = z.strictObject({
  confirmReset: z.literal(true),
  historyKey: newHistoryKeySchema,
  recoveryKey: recoveryKeySchema,
  resetToken: z.string().min(1).max(128).optional(),
});

export const addHistoryWrapsSchema = z.strictObject({
  deviceId: z.string().min(1).max(128),
  groupId: z.string().min(1),
  historyKeyId: z.uuid(),
  wraps: z.array(wrappedHistoryEpochKeySchema).min(1).max(50),
});
