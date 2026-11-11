import { decodeBase64, encodeBase64 } from "./base64.ts";
import { openBase, sealBase } from "./hpke.ts";
import type { DevicePrivateKeyMaterial } from "./sensitive.ts";

const SESSION_LINK_CHALLENGE_LENGTH = 32;

const getInfo = (userId: string, deviceId: string) =>
  new TextEncoder().encode(JSON.stringify(["openbeacon.session-link.v1", userId, deviceId]));

export const sealSessionLinkChallenge = ({
  challenge,
  deviceId,
  devicePublicKey,
  userId,
}: {
  challenge: Uint8Array;
  deviceId: string;
  devicePublicKey: string;
  userId: string;
}) => {
  if (challenge.length !== SESSION_LINK_CHALLENGE_LENGTH) {
    throw new Error("Invalid session link challenge length.");
  }
  const sealed = sealBase({
    aad: new Uint8Array(),
    info: getInfo(userId, deviceId),
    plaintext: challenge,
    recipientPublicKey: decodeBase64(devicePublicKey),
  });
  return { ciphertext: encodeBase64(sealed.ciphertext), enc: encodeBase64(sealed.enc) };
};

export const openSessionLinkChallenge = ({
  deviceId,
  devicePrivateKey,
  sealed,
  userId,
}: {
  deviceId: string;
  devicePrivateKey: DevicePrivateKeyMaterial;
  sealed: { ciphertext: string; enc: string };
  userId: string;
}) => {
  const challenge = openBase({
    aad: new Uint8Array(),
    ciphertext: decodeBase64(sealed.ciphertext),
    enc: decodeBase64(sealed.enc),
    info: getInfo(userId, deviceId),
    recipientPrivateKey: devicePrivateKey.expose(),
  });
  if (challenge.length !== SESSION_LINK_CHALLENGE_LENGTH) {
    throw new Error("Invalid session link challenge length.");
  }
  return encodeBase64(challenge);
};
