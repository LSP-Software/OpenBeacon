import z from "zod";
import { decodeBase64, encodeBase64 } from "./base64.ts";
import { openAuthPsk, sealAuthPsk } from "./hpke.ts";
import { getHistoryPublicKey } from "./recovery.ts";
import { type DevicePrivateKeyMaterial, HistoryPrivateKeyMaterial } from "./sensitive.ts";

const DEVICE_LINK_CONTEXT = "openbeacon.device-link.v1";
const DEVICE_LINK_CODE_PREFIX = "openbeacon-link:1:";
const KEY_LENGTH = 32;
const textEncoder = new TextEncoder();

const handoverSchema = z
  .object({
    historyKeys: z
      .array(
        z
          .object({
            privateKey: z.string().min(1).max(64),
            version: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
    v: z.literal(1),
  })
  .strict();

const getInfo = ({
  linkId,
  newDeviceId,
  userId,
}: {
  linkId: string;
  newDeviceId: string;
  userId: string;
}) => textEncoder.encode(JSON.stringify([DEVICE_LINK_CONTEXT, userId, linkId, newDeviceId]));

const encodeBase64Url = (bytes: Uint8Array) =>
  encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const decodeBase64Url = (value: string) =>
  decodeBase64(value.replace(/-/g, "+").replace(/_/g, "/"));

const ensureKeyLength = (bytes: Uint8Array) => {
  if (bytes.length !== KEY_LENGTH) throw new Error("Invalid device link key length.");
  return bytes;
};

export const createDeviceLinkSecret = () =>
  globalThis.crypto.getRandomValues(new Uint8Array(KEY_LENGTH));

export const formatDeviceLinkCode = ({
  devicePublicKey,
  linkId,
  psk,
}: {
  devicePublicKey: string;
  linkId: string;
  psk: Uint8Array;
}) =>
  `${DEVICE_LINK_CODE_PREFIX}${linkId}:${encodeBase64Url(ensureKeyLength(decodeBase64(devicePublicKey)))}:${encodeBase64Url(ensureKeyLength(psk))}`;

export const parseDeviceLinkCode = (code: string) => {
  const match =
    /^openbeacon-link:1:([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{43}):([A-Za-z0-9_-]{43})$/.exec(
      code.trim(),
    );
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return {
    devicePublicKey: encodeBase64(decodeBase64Url(match[2])),
    linkId: match[1],
    psk: decodeBase64Url(match[3]),
  };
};

export const sealDeviceLinkHandover = ({
  approverPrivateKey,
  ephemeralPrivateKey,
  historyKeys,
  linkId,
  newDeviceId,
  newDevicePublicKey,
  psk,
  userId,
}: {
  approverPrivateKey: DevicePrivateKeyMaterial;
  ephemeralPrivateKey?: Uint8Array;
  historyKeys: { privateKey: HistoryPrivateKeyMaterial; version: number }[];
  linkId: string;
  newDeviceId: string;
  newDevicePublicKey: string;
  psk: Uint8Array;
  userId: string;
}) => {
  const plaintext = handoverSchema.parse({
    historyKeys: historyKeys
      .slice()
      .sort((left, right) => left.version - right.version)
      .map(({ privateKey, version }) => ({
        privateKey: encodeBase64(privateKey.expose()),
        version,
      })),
    v: 1,
  });
  const sealed = sealAuthPsk({
    aad: new Uint8Array(),
    info: getInfo({ linkId, newDeviceId, userId }),
    plaintext: textEncoder.encode(JSON.stringify(plaintext)),
    psk: ensureKeyLength(psk),
    pskId: textEncoder.encode(DEVICE_LINK_CONTEXT),
    recipientPublicKey: ensureKeyLength(decodeBase64(newDevicePublicKey)),
    senderPrivateKey: approverPrivateKey.expose(),
    ...(ephemeralPrivateKey === undefined ? {} : { ephemeralPrivateKey }),
  });
  return { ciphertext: encodeBase64(sealed.ciphertext), enc: encodeBase64(sealed.enc) };
};

export const openDeviceLinkHandover = ({
  approverPublicKey,
  devicePrivateKey,
  linkId,
  newDeviceId,
  psk,
  publishedHistoryKeys,
  sealed,
  userId,
}: {
  approverPublicKey: string;
  devicePrivateKey: DevicePrivateKeyMaterial;
  linkId: string;
  newDeviceId: string;
  psk: Uint8Array;
  publishedHistoryKeys: { publicKey: string; version: number }[];
  sealed: { ciphertext: string; enc: string };
  userId: string;
}) => {
  const plaintext = openAuthPsk({
    aad: new Uint8Array(),
    ciphertext: decodeBase64(sealed.ciphertext),
    enc: ensureKeyLength(decodeBase64(sealed.enc)),
    info: getInfo({ linkId, newDeviceId, userId }),
    psk: ensureKeyLength(psk),
    pskId: textEncoder.encode(DEVICE_LINK_CONTEXT),
    recipientPrivateKey: devicePrivateKey.expose(),
    senderPublicKey: ensureKeyLength(decodeBase64(approverPublicKey)),
  });
  const handover = handoverSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
  const versions = new Set(handover.historyKeys.map(({ version }) => version));
  if (versions.size !== handover.historyKeys.length) {
    throw new Error("The handover repeats a History key version.");
  }
  return handover.historyKeys.map(({ privateKey, version }) => {
    const key = new HistoryPrivateKeyMaterial(ensureKeyLength(decodeBase64(privateKey)));
    const published = publishedHistoryKeys.find((historyKey) => historyKey.version === version);
    if (!published || getHistoryPublicKey(key) !== published.publicKey) {
      throw new Error("A handed-over History key doesn't match your account.");
    }
    return { privateKey: key, version };
  });
};
