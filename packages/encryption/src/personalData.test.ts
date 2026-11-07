import { describe, expect, test } from "bun:test";
import { createDeviceKeyPair, DevicePrivateKeyMaterial } from "./index.ts";
import { openPersonalData, sealPersonalData } from "./personalData.ts";

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
