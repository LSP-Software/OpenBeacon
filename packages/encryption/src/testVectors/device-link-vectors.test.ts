import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hexToBytes } from "@noble/hashes/utils.js";
import { openAuthPsk } from "../hpke.ts";
import {
  DevicePrivateKeyMaterial,
  decodeBase64,
  encodeBase64,
  formatDeviceLinkCode,
  HistoryPrivateKeyMaterial,
  openDeviceLinkHandover,
  parseDeviceLinkCode,
  sealDeviceLinkHandover,
} from "../index.ts";

const vectors = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "device-link-v1.json"), "utf8"),
) as {
  approverPrivateKeyHex: string;
  approverPublicKeyBase64: string;
  ciphertextBase64: string;
  code: string;
  encBase64: string;
  ephemeralPrivateKeyHex: string;
  historyKeys: { privateKeyHex: string; publicKeyBase64: string; version: number }[];
  infoJson: string;
  linkId: string;
  newDeviceId: string;
  newDevicePrivateKeyHex: string;
  newDevicePublicKeyBase64: string;
  plaintextJson: string;
  pskHex: string;
  pskId: string;
  userId: string;
  version: number;
};
const textEncoder = new TextEncoder();
const psk = hexToBytes(vectors.pskHex);

describe("device link v1 vectors", () => {
  test("the QR code has the documented layout", () => {
    expect(vectors.version).toBe(1);
    expect(
      formatDeviceLinkCode({
        devicePublicKey: vectors.newDevicePublicKeyBase64,
        linkId: vectors.linkId,
        psk,
      }),
    ).toBe(vectors.code);
    expect(parseDeviceLinkCode(vectors.code)).toEqual({
      devicePublicKey: vectors.newDevicePublicKeyBase64,
      linkId: vectors.linkId,
      psk,
    });
  });

  test("the handover is HPKE AuthPSK over the documented plaintext, info and PSK id", () => {
    const sealed = sealDeviceLinkHandover({
      approverPrivateKey: new DevicePrivateKeyMaterial(hexToBytes(vectors.approverPrivateKeyHex)),
      ephemeralPrivateKey: hexToBytes(vectors.ephemeralPrivateKeyHex),
      historyKeys: vectors.historyKeys.map(({ privateKeyHex, version }) => ({
        privateKey: new HistoryPrivateKeyMaterial(hexToBytes(privateKeyHex)),
        version,
      })),
      linkId: vectors.linkId,
      newDeviceId: vectors.newDeviceId,
      newDevicePublicKey: vectors.newDevicePublicKeyBase64,
      psk,
      userId: vectors.userId,
    });

    expect(sealed).toEqual({ ciphertext: vectors.ciphertextBase64, enc: vectors.encBase64 });
    expect(
      new TextDecoder().decode(
        openAuthPsk({
          aad: new Uint8Array(),
          ciphertext: decodeBase64(vectors.ciphertextBase64),
          enc: decodeBase64(vectors.encBase64),
          info: textEncoder.encode(vectors.infoJson),
          psk,
          pskId: textEncoder.encode(vectors.pskId),
          recipientPrivateKey: hexToBytes(vectors.newDevicePrivateKeyHex),
          senderPublicKey: decodeBase64(vectors.approverPublicKeyBase64),
        }),
      ),
    ).toBe(vectors.plaintextJson);
  });

  test("the new device opens the vector handover", () => {
    const opened = openDeviceLinkHandover({
      approverPublicKey: vectors.approverPublicKeyBase64,
      devicePrivateKey: new DevicePrivateKeyMaterial(hexToBytes(vectors.newDevicePrivateKeyHex)),
      linkId: vectors.linkId,
      newDeviceId: vectors.newDeviceId,
      psk,
      publishedHistoryKeys: vectors.historyKeys.map(({ publicKeyBase64, version }) => ({
        publicKey: publicKeyBase64,
        version,
      })),
      sealed: { ciphertext: vectors.ciphertextBase64, enc: vectors.encBase64 },
      userId: vectors.userId,
    });

    expect(
      opened.map(({ privateKey, version }) => ({
        privateKeyBase64: encodeBase64(privateKey.expose()),
        version,
      })),
    ).toEqual(
      vectors.historyKeys.map(({ privateKeyHex, version }) => ({
        privateKeyBase64: encodeBase64(hexToBytes(privateKeyHex)),
        version,
      })),
    );
  });
});
