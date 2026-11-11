import { describe, expect, test } from "bun:test";
import { sealAuthPsk } from "./hpke.ts";
import {
  createDeviceKeyPair,
  createDeviceLinkSecret,
  createHistoryKeyPair,
  decodeBase64,
  encodeBase64,
  formatDeviceLinkCode,
  openDeviceLinkHandover,
  parseDeviceLinkCode,
  sealDeviceLinkHandover,
} from "./index.ts";

const approver = createDeviceKeyPair();
const newDevice = createDeviceKeyPair();
const historyV1 = createHistoryKeyPair();
const historyV2 = createHistoryKeyPair();
const psk = createDeviceLinkSecret();
const link = { linkId: "link-1", newDeviceId: "device-new", userId: "user-1" };
const publishedHistoryKeys = [
  { publicKey: historyV1.publicKey, version: 1 },
  { publicKey: historyV2.publicKey, version: 2 },
];

const seal = (overrides: Partial<Parameters<typeof sealDeviceLinkHandover>[0]> = {}) =>
  sealDeviceLinkHandover({
    ...link,
    approverPrivateKey: approver.privateKey,
    historyKeys: [
      { privateKey: historyV1.privateKey, version: 1 },
      { privateKey: historyV2.privateKey, version: 2 },
    ],
    newDevicePublicKey: newDevice.publicKey,
    psk,
    ...overrides,
  });

const open = (
  sealed: { ciphertext: string; enc: string },
  overrides: Partial<Parameters<typeof openDeviceLinkHandover>[0]> = {},
) =>
  openDeviceLinkHandover({
    ...link,
    approverPublicKey: approver.publicKey,
    devicePrivateKey: newDevice.privateKey,
    psk,
    publishedHistoryKeys,
    sealed,
    ...overrides,
  });

const sealPlaintext = (plaintext: unknown) => {
  const sealed = sealAuthPsk({
    aad: new Uint8Array(),
    info: new TextEncoder().encode(
      JSON.stringify(["openbeacon.device-link.v1", link.userId, link.linkId, link.newDeviceId]),
    ),
    plaintext: new TextEncoder().encode(JSON.stringify(plaintext)),
    psk,
    pskId: new TextEncoder().encode("openbeacon.device-link.v1"),
    recipientPublicKey: decodeBase64(newDevice.publicKey),
    senderPrivateKey: approver.privateKey.expose(),
  });
  return { ciphertext: encodeBase64(sealed.ciphertext), enc: encodeBase64(sealed.enc) };
};

describe("device link handover", () => {
  test("hands over every History key version", () => {
    const opened = open(seal());

    expect(opened.map(({ version }) => version)).toEqual([1, 2]);
    expect(encodeBase64(opened[0]?.privateKey.expose() ?? new Uint8Array())).toBe(
      encodeBase64(historyV1.privateKey.expose()),
    );
    expect(encodeBase64(opened[1]?.privateKey.expose() ?? new Uint8Array())).toBe(
      encodeBase64(historyV2.privateKey.expose()),
    );
  });

  test("doesn't open without the QR code's secret", () => {
    expect(() => open(seal(), { psk: createDeviceLinkSecret() })).toThrow();
    expect(() => open(seal({ psk: createDeviceLinkSecret() }))).toThrow();
  });

  test("doesn't open on a device it wasn't sealed to", () => {
    const otherDevice = createDeviceKeyPair();

    expect(() => open(seal(), { devicePrivateKey: otherDevice.privateKey })).toThrow();
    expect(() => open(seal({ newDevicePublicKey: otherDevice.publicKey }))).toThrow();
  });

  test("doesn't open for a different link, account or device", () => {
    const sealed = seal();

    expect(() => open(sealed, { linkId: "link-2" })).toThrow();
    expect(() => open(sealed, { userId: "user-2" })).toThrow();
    expect(() => open(sealed, { newDeviceId: "device-other" })).toThrow();
  });

  test("doesn't open when another device claims to have sealed it", () => {
    const forger = createDeviceKeyPair();

    expect(() => open(seal(), { approverPublicKey: forger.publicKey })).toThrow();
    expect(() => open(seal({ approverPrivateKey: forger.privateKey }))).toThrow();
  });

  test("rejects a key that doesn't match its published History public key", () => {
    const stranger = createHistoryKeyPair();

    expect(() =>
      open(seal({ historyKeys: [{ privateKey: stranger.privateKey, version: 1 }] })),
    ).toThrow("doesn't match");
    expect(() =>
      open(seal({ historyKeys: [{ privateKey: historyV1.privateKey, version: 2 }] })),
    ).toThrow("doesn't match");
    expect(() =>
      open(seal({ historyKeys: [{ privateKey: historyV1.privateKey, version: 3 }] })),
    ).toThrow("doesn't match");
  });

  test("rejects a handover that breaks the strict format", () => {
    const v1 = { privateKey: encodeBase64(historyV1.privateKey.expose()), version: 1 };

    expect(() => open(sealPlaintext({ historyKeys: [v1], v: 2 }))).toThrow();
    expect(() => open(sealPlaintext({ historyKeys: [], v: 1 }))).toThrow();
    expect(() => open(sealPlaintext({ extra: true, historyKeys: [v1], v: 1 }))).toThrow();
    expect(() => open(sealPlaintext({ historyKeys: [v1, v1], v: 1 }))).toThrow();
    expect(() =>
      open(sealPlaintext({ historyKeys: [{ ...v1, privateKey: "AAAA" }], v: 1 })),
    ).toThrow();
    expect(open(sealPlaintext({ historyKeys: [v1], v: 1 })).map(({ version }) => version)).toEqual([
      1,
    ]);
  });
});

describe("device link QR code", () => {
  test("round-trips and rejects anything else", () => {
    const code = formatDeviceLinkCode({
      devicePublicKey: newDevice.publicKey,
      linkId: "abc_123-DEF",
      psk,
    });

    expect(code.startsWith("openbeacon-link:1:abc_123-DEF:")).toBe(true);
    expect(parseDeviceLinkCode(code)).toEqual({
      devicePublicKey: newDevice.publicKey,
      linkId: "abc_123-DEF",
      psk,
    });
    expect(parseDeviceLinkCode(code.replace("link:1:", "link:2:"))).toBeNull();
    expect(parseDeviceLinkCode(`${code}A`)).toBeNull();
    expect(parseDeviceLinkCode("https://example.com/join/ABCDEF")).toBeNull();
    expect(() =>
      formatDeviceLinkCode({
        devicePublicKey: newDevice.publicKey,
        linkId: "x",
        psk: new Uint8Array(16),
      }),
    ).toThrow();
  });
});
