import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { openBase } from "../hpke.ts";
import {
  decodeBase64,
  DevicePrivateKeyMaterial,
  getPersonalDataHistoryKeyVersion,
  HistoryPrivateKeyMaterial,
  openPersonalData,
  openProfileImageKey,
  type PersonalDataPurpose,
} from "../index.ts";

const file = JSON.parse(
  readFileSync(new URL("./vectors/personal-data-v2-v3.json", import.meta.url), "utf8"),
) as {
  devicePrivateKeyHex: string;
  historyKeyVersion: number;
  historyPrivateKeyHex: string;
  vectors: {
    binding: string[];
    imageKeyHex?: string;
    name: string;
    plaintext?: string;
    purpose: PersonalDataPurpose;
    sealed: string;
  }[];
};

const fromHex = (hex: string) => new Uint8Array(Buffer.from(hex, "hex"));
const devicePrivateKey = new DevicePrivateKeyMaterial(fromHex(file.devicePrivateKeyHex));
const historyPrivateKey = new HistoryPrivateKeyMaterial(fromHex(file.historyPrivateKeyHex));
const historyPrivateKeys = new Map([[file.historyKeyVersion, historyPrivateKey]]);
const textVectors = file.vectors.filter((vector) => vector.plaintext !== undefined);

describe("frozen personal data vectors", () => {
  test("the file covers v2 and v3 nicknames, colours and a profile picture key", () => {
    expect(file.vectors.map((vector) => vector.name)).toEqual([
      "v2 nickname",
      "v2 group colour",
      "v3 nickname",
      "v3 group colour",
      "v3 profile picture key",
    ]);
  });

  test("every committed nickname and colour still opens with today's code", () => {
    for (const vector of textVectors) {
      expect(
        openPersonalData({
          binding: vector.binding,
          historyPrivateKeys,
          privateKey: devicePrivateKey,
          purpose: vector.purpose,
          sealed: vector.sealed,
        }),
      ).toBe(vector.plaintext ?? "");
    }
  });

  test("the committed profile picture key still opens", () => {
    const vector = file.vectors.find((entry) => entry.purpose === "profile-image");
    const [userId, fileName] = vector?.binding ?? [];
    if (!vector || userId === undefined || fileName === undefined) {
      throw new Error("Missing profile picture vector.");
    }

    expect(
      openProfileImageKey({
        fileName,
        historyPrivateKeys,
        sealed: vector.sealed,
        userId,
      }).expose(),
    ).toEqual(fromHex(vector.imageKeyHex ?? ""));
  });

  test("each envelope reports the History key version it was sealed to", () => {
    expect(file.vectors.map((vector) => getPersonalDataHistoryKeyVersion(vector.sealed))).toEqual([
      null,
      null,
      file.historyKeyVersion,
      file.historyKeyVersion,
      file.historyKeyVersion,
    ]);
  });

  test("each envelope is HPKE Base over the documented info, independent of openPersonalData", () => {
    for (const vector of file.vectors) {
      const envelope = JSON.parse(vector.sealed) as {
        ciphertext: string;
        enc: string;
        historyKeyVersion?: number;
        version: 2 | 3;
      };
      const context =
        envelope.version === 2
          ? ["openbeacon.personal-data.v2"]
          : ["openbeacon.personal-data.v3", envelope.historyKeyVersion];
      const plaintext = openBase({
        aad: new Uint8Array(),
        ciphertext: decodeBase64(envelope.ciphertext),
        enc: decodeBase64(envelope.enc),
        info: new TextEncoder().encode(
          JSON.stringify([...context, vector.purpose, ...vector.binding]),
        ),
        recipientPrivateKey: (envelope.version === 2
          ? devicePrivateKey
          : historyPrivateKey
        ).expose(),
      });

      expect(new TextDecoder().decode(plaintext)).toBe(
        vector.plaintext ?? Buffer.from(fromHex(vector.imageKeyHex ?? "")).toString("base64"),
      );
    }
  });

  test("no committed envelope opens under another purpose or a shifted binding", () => {
    const purposes: PersonalDataPurpose[] = ["nickname", "group-color", "profile-image"];
    for (const vector of file.vectors) {
      for (const purpose of purposes.filter((candidate) => candidate !== vector.purpose)) {
        expect(() =>
          openPersonalData({
            binding: vector.binding,
            historyPrivateKeys,
            privateKey: devicePrivateKey,
            purpose,
            sealed: vector.sealed,
          }),
        ).toThrow();
      }
      expect(() =>
        openPersonalData({
          binding: vector.binding.slice(1),
          historyPrivateKeys,
          privateKey: devicePrivateKey,
          purpose: vector.purpose,
          sealed: vector.sealed,
        }),
      ).toThrow();
    }
  });
});
