import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { decodeBase64, encodeBase64 } from "./base64.ts";
import {
  GROUP_EPOCH_DOMAIN_CONTEXT,
  GROUP_EPOCH_KEY_LENGTH,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  XCHACHA20_NONCE_LENGTH,
} from "./constants.ts";
import { openPersonalData, sealPersonalDataForHistoryKey } from "./personalData.ts";
import {
  type EpochKeyMaterial,
  type HistoryPrivateKeyMaterial,
  ImageKeyMaterial,
  type SensitiveBytes,
} from "./sensitive.ts";
import type { EncryptedImageKey, HistoryPublicKey, ImageKeyKind, ImagePurpose } from "./types.ts";

export const IMAGE_ENCRYPTION_CONTEXT = "openbeacon.image.v1";
export const IMAGE_ENCRYPTION_VERSION = 1;
export const IMAGE_KEY_LENGTH = 32;

const TAG_LENGTH = 16;
const HEADER_LENGTH = 1 + XCHACHA20_NONCE_LENGTH;
export const MIN_ENCRYPTED_IMAGE_LENGTH = HEADER_LENGTH + TAG_LENGTH;
export const ENCRYPTED_IMAGE_KEY_LENGTH = IMAGE_KEY_LENGTH + TAG_LENGTH;

const textEncoder = new TextEncoder();

const getImageAssociatedData = ({
  fileName,
  ownerId,
  purpose,
}: {
  fileName: string;
  ownerId: string;
  purpose: ImagePurpose;
}) =>
  textEncoder.encode(
    JSON.stringify({ context: IMAGE_ENCRYPTION_CONTEXT, fileName, ownerId, purpose }),
  );

const getImageKeyAssociatedData = ({
  epochId,
  fileName,
  groupId,
  kind,
  ownerId,
  senderDeviceId,
}: {
  epochId: string;
  fileName: string;
  groupId: string;
  kind: ImageKeyKind;
  ownerId: string;
  senderDeviceId: string;
}) =>
  textEncoder.encode(
    JSON.stringify({
      context: GROUP_EPOCH_DOMAIN_CONTEXT,
      epochId,
      fileName,
      groupId,
      kind,
      ownerId,
      purpose: "image-key",
      senderDeviceId,
    }),
  );

const exposeKey = (key: SensitiveBytes, length: number) => {
  const bytes = key.expose();
  if (bytes.length !== length) {
    throw new Error("Invalid key length.");
  }
  return bytes;
};

const checkNonce = (nonce: Uint8Array) => {
  if (nonce.length !== XCHACHA20_NONCE_LENGTH) {
    throw new Error("Invalid nonce length.");
  }
  return nonce;
};

export const generateImageKey = () => new ImageKeyMaterial(randomBytes(IMAGE_KEY_LENGTH));

export const encryptImageWithKeyAndNonce = ({
  bytes,
  fileName,
  key,
  nonce,
  ownerId,
  purpose,
}: {
  bytes: Uint8Array;
  fileName: string;
  key: ImageKeyMaterial;
  nonce: Uint8Array;
  ownerId: string;
  purpose: ImagePurpose;
}) => {
  const ciphertext = xchacha20poly1305(
    exposeKey(key, IMAGE_KEY_LENGTH),
    checkNonce(nonce),
    getImageAssociatedData({ fileName, ownerId, purpose }),
  ).encrypt(bytes);
  const blob = new Uint8Array(HEADER_LENGTH + ciphertext.length);
  blob[0] = IMAGE_ENCRYPTION_VERSION;
  blob.set(nonce, 1);
  blob.set(ciphertext, HEADER_LENGTH);
  return { blob, key };
};

export const encryptImage = ({
  bytes,
  fileName,
  ownerId,
  purpose,
}: {
  bytes: Uint8Array;
  fileName: string;
  ownerId: string;
  purpose: ImagePurpose;
}) =>
  encryptImageWithKeyAndNonce({
    bytes,
    fileName,
    key: generateImageKey(),
    nonce: randomBytes(XCHACHA20_NONCE_LENGTH),
    ownerId,
    purpose,
  });

export const decryptImage = ({
  blob,
  fileName,
  key,
  ownerId,
  purpose,
}: {
  blob: Uint8Array;
  fileName: string;
  key: ImageKeyMaterial;
  ownerId: string;
  purpose: ImagePurpose;
}) => {
  if (blob.length < MIN_ENCRYPTED_IMAGE_LENGTH) {
    throw new Error("Encrypted image is too short.");
  }
  if (blob[0] !== IMAGE_ENCRYPTION_VERSION) {
    throw new Error("Unsupported encrypted image version.");
  }
  return xchacha20poly1305(
    exposeKey(key, IMAGE_KEY_LENGTH),
    blob.subarray(1, HEADER_LENGTH),
    getImageAssociatedData({ fileName, ownerId, purpose }),
  ).decrypt(blob.subarray(HEADER_LENGTH));
};

export const encryptImageKey = ({
  epochId,
  epochKey,
  fileName,
  groupId,
  imageKey,
  kind,
  nonce = randomBytes(XCHACHA20_NONCE_LENGTH),
  ownerId,
  senderDeviceId,
}: {
  epochId: string;
  epochKey: EpochKeyMaterial;
  fileName: string;
  groupId: string;
  imageKey: ImageKeyMaterial;
  kind: ImageKeyKind;
  nonce?: Uint8Array;
  ownerId: string;
  senderDeviceId: string;
}): EncryptedImageKey => {
  const ciphertext = xchacha20poly1305(
    exposeKey(epochKey, GROUP_EPOCH_KEY_LENGTH),
    checkNonce(nonce),
    getImageKeyAssociatedData({ epochId, fileName, groupId, kind, ownerId, senderDeviceId }),
  ).encrypt(exposeKey(imageKey, IMAGE_KEY_LENGTH));
  return {
    algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
    ciphertext: encodeBase64(ciphertext),
    epochId,
    nonce: encodeBase64(nonce),
    senderDeviceId,
  };
};

export const decryptImageKey = ({
  encryptedKey,
  epochKey,
  fileName,
  groupId,
  kind,
  ownerId,
}: {
  encryptedKey: Omit<EncryptedImageKey, "algorithm"> & { algorithm: string };
  epochKey: EpochKeyMaterial;
  fileName: string;
  groupId: string;
  kind: ImageKeyKind;
  ownerId: string;
}) => {
  if (encryptedKey.algorithm !== PAYLOAD_ENCRYPTION_ALGORITHM) {
    throw new Error("Unsupported image key algorithm.");
  }
  const imageKey = xchacha20poly1305(
    exposeKey(epochKey, GROUP_EPOCH_KEY_LENGTH),
    checkNonce(decodeBase64(encryptedKey.nonce)),
    getImageKeyAssociatedData({
      epochId: encryptedKey.epochId,
      fileName,
      groupId,
      kind,
      ownerId,
      senderDeviceId: encryptedKey.senderDeviceId,
    }),
  ).decrypt(decodeBase64(encryptedKey.ciphertext));
  if (imageKey.length !== IMAGE_KEY_LENGTH) {
    throw new Error("Invalid key length.");
  }
  return new ImageKeyMaterial(imageKey);
};

export const sealProfileImageKey = ({
  fileName,
  historyKey,
  imageKey,
  userId,
}: {
  fileName: string;
  historyKey: Pick<HistoryPublicKey, "publicKey" | "version">;
  imageKey: ImageKeyMaterial;
  userId: string;
}) =>
  sealPersonalDataForHistoryKey({
    historyKey,
    purpose: "profile-image",
    binding: [userId, fileName],
    plaintext: encodeBase64(exposeKey(imageKey, IMAGE_KEY_LENGTH)),
  });

export const openProfileImageKey = ({
  fileName,
  historyPrivateKeys,
  sealed,
  userId,
}: {
  fileName: string;
  historyPrivateKeys: ReadonlyMap<number, HistoryPrivateKeyMaterial>;
  sealed: string;
  userId: string;
}) => {
  const imageKey = decodeBase64(
    openPersonalData({
      historyPrivateKeys,
      purpose: "profile-image",
      binding: [userId, fileName],
      sealed,
    }),
  );
  if (imageKey.length !== IMAGE_KEY_LENGTH) {
    throw new Error("Invalid key length.");
  }
  return new ImageKeyMaterial(imageKey);
};
