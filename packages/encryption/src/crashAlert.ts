import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { decodeBase64, encodeBase64 } from "./base64.ts";
import { GROUP_EPOCH_DOMAIN_CONTEXT, XCHACHA20_NONCE_LENGTH } from "./constants.ts";
import type { EpochKeyMaterial } from "./sensitive.ts";

export const CRASH_ALERT_KIND = "crash" as const;
export const CRASH_ALERT_VERSION = 1;
export const CRASH_ALERT_LENGTH = 128;
export const ENCRYPTED_CRASH_ALERT_LENGTH = CRASH_ALERT_LENGTH + 16;
export const CRASH_ALERT_PLACE_LABEL_BYTES = 64;

export type CrashAlertMessage = {
  type: "CRASH" | "OK";
  messageId: string;
  alertId: string;
  crash: { time: number; latitude: number; longitude: number; speedBefore: number };
  sharingUntil: number;
  okAt: number | null;
  placeLabel: string | null;
};

export type SealedCrashAlert = { ciphertext: string; messageId: string; nonce: string };

const TYPES = ["CRASH", "OK"] as const;
const LABEL_OFFSET = 63;
const UINT32 = 2 ** 32;
const ID_PATTERN = /^[0-9a-f]{32}$/;

const invalid = () => new Error("Invalid crash alert.");
const unreadable = () => new Error("Unreadable crash alert.");

const setUint48 = (view: DataView, offset: number, value: number) => {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** 48) throw invalid();
  view.setUint16(offset, Math.floor(value / UINT32));
  view.setUint32(offset + 2, value % UINT32);
};

const getUint48 = (view: DataView, offset: number) =>
  view.getUint16(offset) * UINT32 + view.getUint32(offset + 2);

const toE7 = (value: number, limit: number) => {
  if (!Number.isFinite(value) || Math.abs(value) > limit) throw invalid();
  return Math.round(value * 1e7);
};

const labelBytes = (label: string) => {
  const encoder = new TextEncoder();
  let bytes = encoder.encode(label);
  let characters = [...label];
  while (bytes.length > CRASH_ALERT_PLACE_LABEL_BYTES) {
    characters = characters.slice(0, -1);
    bytes = encoder.encode(characters.join(""));
  }
  return bytes;
};

export const encodeCrashAlert = (message: CrashAlertMessage) => {
  const { crash } = message;
  const speed = Math.round(crash.speedBefore * 100);
  if (
    !ID_PATTERN.test(message.messageId) ||
    !ID_PATTERN.test(message.alertId) ||
    (message.type === "CRASH") !== (message.okAt === null) ||
    (message.type === "CRASH" && message.alertId !== message.messageId) ||
    !Number.isFinite(crash.speedBefore) ||
    speed < 0 ||
    speed > 0xffff
  ) {
    throw invalid();
  }
  const bytes = new Uint8Array(CRASH_ALERT_LENGTH);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, CRASH_ALERT_VERSION);
  view.setUint8(1, TYPES.indexOf(message.type) + 1);
  for (let index = 0; index < 16; index += 1) {
    const at = index * 2;
    view.setUint8(2 + index, Number.parseInt(message.messageId.slice(at, at + 2), 16));
    view.setUint8(18 + index, Number.parseInt(message.alertId.slice(at, at + 2), 16));
  }
  setUint48(view, 34, crash.time);
  view.setInt32(40, toE7(crash.latitude, 90));
  view.setInt32(44, toE7(crash.longitude, 180));
  view.setUint16(48, speed);
  setUint48(view, 50, message.sharingUntil);
  if (message.okAt !== null && message.okAt <= 0) throw invalid();
  setUint48(view, 56, message.okAt ?? 0);
  const label = labelBytes(message.placeLabel ?? "");
  view.setUint8(62, label.length);
  bytes.set(label, LABEL_OFFSET);
  return bytes;
};

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const decodeCrashAlert = (bytes: Uint8Array): CrashAlertMessage => {
  if (bytes.length !== CRASH_ALERT_LENGTH) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = TYPES[view.getUint8(1) - 1];
  const labelLength = view.getUint8(62);
  const latitude = view.getInt32(40);
  const longitude = view.getInt32(44);
  const okAt = getUint48(view, 56);
  const messageId = hex(bytes.subarray(2, 18));
  const alertId = hex(bytes.subarray(18, 34));
  if (
    view.getUint8(0) !== CRASH_ALERT_VERSION ||
    !type ||
    labelLength > CRASH_ALERT_PLACE_LABEL_BYTES ||
    Math.abs(latitude) > 900_000_000 ||
    Math.abs(longitude) > 1_800_000_000 ||
    (type === "CRASH") !== (okAt === 0) ||
    (type === "CRASH" && alertId !== messageId) ||
    bytes.subarray(LABEL_OFFSET + labelLength).some((byte) => byte !== 0)
  ) {
    throw invalid();
  }
  let placeLabel: string;
  try {
    placeLabel = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(LABEL_OFFSET, LABEL_OFFSET + labelLength),
    );
  } catch {
    throw invalid();
  }
  return {
    type,
    messageId,
    alertId,
    crash: {
      time: getUint48(view, 34),
      latitude: latitude / 1e7,
      longitude: longitude / 1e7,
      speedBefore: view.getUint16(48) / 100,
    },
    sharingUntil: getUint48(view, 50),
    okAt: okAt === 0 ? null : okAt,
    placeLabel: placeLabel === "" ? null : placeLabel,
  };
};

export const crashAlertAssociatedData = ({
  epochId,
  groupId,
  messageId,
  senderDeviceId,
}: {
  epochId: string;
  groupId: string;
  messageId: string;
  senderDeviceId: string;
}) =>
  new TextEncoder().encode(
    JSON.stringify({
      context: GROUP_EPOCH_DOMAIN_CONTEXT,
      epochId,
      groupId,
      kind: CRASH_ALERT_KIND,
      messageId,
      purpose: "payload",
      senderDeviceId,
    }),
  );

export const sealCrashAlert = ({
  epochId,
  epochKey,
  groupId,
  message,
  nonce = randomBytes(XCHACHA20_NONCE_LENGTH),
  senderDeviceId,
}: {
  epochId: string;
  epochKey: EpochKeyMaterial;
  groupId: string;
  message: CrashAlertMessage;
  nonce?: Uint8Array;
  senderDeviceId: string;
}): SealedCrashAlert => {
  if (nonce.length !== XCHACHA20_NONCE_LENGTH) throw new Error("Invalid nonce length.");
  const cipher = xchacha20poly1305(
    epochKey.expose(),
    nonce,
    crashAlertAssociatedData({ epochId, groupId, messageId: message.messageId, senderDeviceId }),
  );
  return {
    ciphertext: encodeBase64(cipher.encrypt(encodeCrashAlert(message))),
    messageId: message.messageId,
    nonce: encodeBase64(nonce),
  };
};

export const openCrashAlert = ({
  epochId,
  epochKey,
  groupId,
  sealed,
  senderDeviceId,
}: {
  epochId: string;
  epochKey: EpochKeyMaterial;
  groupId: string;
  sealed: SealedCrashAlert;
  senderDeviceId: string;
}) => {
  let message: CrashAlertMessage;
  try {
    const cipher = xchacha20poly1305(
      epochKey.expose(),
      decodeBase64(sealed.nonce),
      crashAlertAssociatedData({ epochId, groupId, messageId: sealed.messageId, senderDeviceId }),
    );
    message = decodeCrashAlert(cipher.decrypt(decodeBase64(sealed.ciphertext)));
  } catch {
    throw unreadable();
  }
  if (message.messageId !== sealed.messageId) throw unreadable();
  return message;
};
