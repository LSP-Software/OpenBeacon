import { decodeBase64, encodeBase64 } from "./base64.ts";
import { openBase, sealBase } from "./hpke.ts";
import type { HistoryPrivateKeyMaterial } from "./sensitive.ts";

const DEVICE_ACTIVATION_CHALLENGE_LENGTH = 32;

const getInfo = (userId: string, deviceId: string) =>
  new TextEncoder().encode(JSON.stringify(["openbeacon.device-activation.v1", userId, deviceId]));

export const sealDeviceActivationChallenge = ({
  challenge,
  deviceId,
  historyPublicKey,
  userId,
}: {
  challenge: Uint8Array;
  deviceId: string;
  historyPublicKey: string;
  userId: string;
}) => {
  if (challenge.length !== DEVICE_ACTIVATION_CHALLENGE_LENGTH) {
    throw new Error("Invalid device activation challenge length.");
  }
  const sealed = sealBase({
    aad: new Uint8Array(),
    info: getInfo(userId, deviceId),
    plaintext: challenge,
    recipientPublicKey: decodeBase64(historyPublicKey),
  });
  return { ciphertext: encodeBase64(sealed.ciphertext), enc: encodeBase64(sealed.enc) };
};

export const openDeviceActivationChallenge = ({
  deviceId,
  historyPrivateKey,
  sealed,
  userId,
}: {
  deviceId: string;
  historyPrivateKey: HistoryPrivateKeyMaterial;
  sealed: { ciphertext: string; enc: string };
  userId: string;
}) => {
  const challenge = openBase({
    aad: new Uint8Array(),
    ciphertext: decodeBase64(sealed.ciphertext),
    enc: decodeBase64(sealed.enc),
    info: getInfo(userId, deviceId),
    recipientPrivateKey: historyPrivateKey.expose(),
  });
  if (challenge.length !== DEVICE_ACTIVATION_CHALLENGE_LENGTH) {
    throw new Error("Invalid device activation challenge length.");
  }
  return encodeBase64(challenge);
};
