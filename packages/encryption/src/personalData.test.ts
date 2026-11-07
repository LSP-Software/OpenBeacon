import { describe, expect, test } from "bun:test";
import { openBase } from "./hpke.ts";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  DevicePrivateKeyMaterial,
  decodeBase64,
} from "./index.ts";
import {
  openPersonalData,
  sealPersonalData,
  sealPersonalDataForHistoryKey,
} from "./personalData.ts";

const binding = ["owner", "family", "member"];

describe("personal data", () => {
  test("opens with a private key restored from its raw bytes", () => {
    const { privateKey } = createDeviceKeyPair();
    const sealed = sealPersonalData({
      privateKey,
      purpose: "nickname",
      binding,
      plaintext: "Gran",
    });
    const restored = new DevicePrivateKeyMaterial(privateKey.expose());

    expect(sealed).not.toContain("Gran");
    expect(openPersonalData({ privateKey: restored, purpose: "nickname", binding, sealed })).toBe(
      "Gran",
    );
  });

  test("uses fresh randomness for every seal", () => {
    const { privateKey } = createDeviceKeyPair();
    const first = sealPersonalData({ privateKey, purpose: "nickname", binding, plaintext: "Gran" });
    const second = sealPersonalData({
      privateKey,
      purpose: "nickname",
      binding,
      plaintext: "Gran",
    });

    expect(first).not.toBe(second);
  });

  test("rejects an unknown envelope version", () => {
    const { privateKey } = createDeviceKeyPair();
    const sealed = sealPersonalData({
      privateKey,
      purpose: "nickname",
      binding,
      plaintext: "Gran",
    });
    const legacy = JSON.stringify({ ...JSON.parse(sealed), version: 1 });

    expect(() =>
      openPersonalData({ privateKey, purpose: "nickname", binding, sealed: legacy }),
    ).toThrow();
  });

  test("rejects another key, purpose or binding", () => {
    const { privateKey } = createDeviceKeyPair();
    const sealed = sealPersonalData({
      privateKey,
      purpose: "nickname",
      binding,
      plaintext: "Gran",
    });

    expect(() =>
      openPersonalData({
        privateKey: createDeviceKeyPair().privateKey,
        purpose: "nickname",
        binding,
        sealed,
      }),
    ).toThrow();
    expect(() =>
      openPersonalData({ privateKey, purpose: "group-color", binding, sealed }),
    ).toThrow();
    for (const changed of [
      ["other", "family", "member"],
      ["owner", "other", "member"],
      ["owner", "family", "other"],
      ["owner", "family"],
    ]) {
      expect(() =>
        openPersonalData({ privateKey, purpose: "nickname", binding: changed, sealed }),
      ).toThrow();
    }
  });
});

describe("personal data sealed to a history key", () => {
  const seal = () => {
    const history = createHistoryKeyPair();
    const sealed = sealPersonalDataForHistoryKey({
      historyKey: { publicKey: history.publicKey, version: 2 },
      purpose: "group-color",
      binding,
      plaintext: "#ff8800",
    });

    return { history, sealed };
  };

  test("opens on any device holding the history key version", () => {
    const { history, sealed } = seal();

    expect(JSON.parse(sealed)).toMatchObject({ version: 3, historyKeyVersion: 2 });
    expect(sealed).not.toContain("#ff8800");
    expect(
      openPersonalData({
        privateKey: createDeviceKeyPair().privateKey,
        historyPrivateKeys: new Map([[2, history.privateKey]]),
        purpose: "group-color",
        binding,
        sealed,
      }),
    ).toBe("#ff8800");
  });

  test("still opens device sealed records alongside history keys", () => {
    const { privateKey } = createDeviceKeyPair();
    const sealed = sealPersonalData({
      privateKey,
      purpose: "nickname",
      binding,
      plaintext: "Gran",
    });

    expect(
      openPersonalData({
        privateKey,
        historyPrivateKeys: new Map([[1, createHistoryKeyPair().privateKey]]),
        purpose: "nickname",
        binding,
        sealed,
      }),
    ).toBe("Gran");
  });

  test("rejects a missing or different history key version", () => {
    const { history, sealed } = seal();
    const { privateKey } = createDeviceKeyPair();

    expect(() => openPersonalData({ privateKey, purpose: "group-color", binding, sealed })).toThrow(
      "Missing history key for personal data.",
    );
    expect(() =>
      openPersonalData({
        privateKey,
        historyPrivateKeys: new Map([[1, history.privateKey]]),
        purpose: "group-color",
        binding,
        sealed,
      }),
    ).toThrow("Missing history key for personal data.");
    expect(() =>
      openPersonalData({
        privateKey,
        historyPrivateKeys: new Map([[2, createHistoryKeyPair().privateKey]]),
        purpose: "group-color",
        binding,
        sealed,
      }),
    ).toThrow();
  });

  test("binds the history key version, purpose and binding into the info", () => {
    const { history, sealed } = seal();
    const envelope = JSON.parse(sealed) as { ciphertext: string; enc: string };

    expect(
      new TextDecoder().decode(
        openBase({
          aad: new Uint8Array(),
          ciphertext: decodeBase64(envelope.ciphertext),
          enc: decodeBase64(envelope.enc),
          info: new TextEncoder().encode(
            '["openbeacon.personal-data.v3",2,"group-color","owner","family","member"]',
          ),
          recipientPrivateKey: history.privateKey.expose(),
        }),
      ),
    ).toBe("#ff8800");
  });

  test("rejects a relabelled history key version, purpose or binding", () => {
    const { history, sealed } = seal();
    const historyPrivateKeys = new Map([[2, history.privateKey]]);
    const { privateKey } = createDeviceKeyPair();
    const relabelled = JSON.stringify({ ...JSON.parse(sealed), historyKeyVersion: 3 });

    expect(() =>
      openPersonalData({
        privateKey,
        historyPrivateKeys: new Map([[3, history.privateKey]]),
        purpose: "group-color",
        binding,
        sealed: relabelled,
      }),
    ).toThrow();

    expect(() =>
      openPersonalData({ privateKey, historyPrivateKeys, purpose: "nickname", binding, sealed }),
    ).toThrow();
    expect(() =>
      openPersonalData({
        privateKey,
        historyPrivateKeys,
        purpose: "group-color",
        binding: ["owner", "family", "other"],
        sealed,
      }),
    ).toThrow();
  });
});
