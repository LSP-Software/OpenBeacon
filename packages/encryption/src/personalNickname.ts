import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { decodeBase64, encodeBase64 } from "./base64.ts";
import type { DevicePrivateKeyMaterial } from "./sensitive.ts";

const encoder = new TextEncoder();
const metadata = (userId: string, groupId: string, memberId: string) =>
  encoder.encode(JSON.stringify(["openbeacon.personal-nickname.v1", userId, groupId, memberId]));

export const encryptPrivateNickname = ({
  privateKey,
  userId,
  groupId,
  memberId,
  nickname,
}: {
  privateKey: DevicePrivateKeyMaterial;
  userId: string;
  groupId: string;
  memberId: string;
  nickname: string;
}) => {
  const associatedData = metadata(userId, groupId, memberId);
  const key = hkdf(sha256, privateKey.expose(), undefined, associatedData, 32);
  const nonce = randomBytes(24);
  return {
    version: 1 as const,
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(
      xchacha20poly1305(key, nonce, associatedData).encrypt(encoder.encode(nickname)),
    ),
  };
};

export const decryptPrivateNickname = ({
  privateKey,
  userId,
  groupId,
  memberId,
  nonce,
  ciphertext,
}: {
  privateKey: DevicePrivateKeyMaterial;
  userId: string;
  groupId: string;
  memberId: string;
  nonce: string;
  ciphertext: string;
}) => {
  const associatedData = metadata(userId, groupId, memberId);
  const key = hkdf(sha256, privateKey.expose(), undefined, associatedData, 32);
  return new TextDecoder().decode(
    xchacha20poly1305(key, decodeBase64(nonce), associatedData).decrypt(decodeBase64(ciphertext)),
  );
};
