import { describe, expect, test } from "bun:test";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  sealPersonalData,
  sealPersonalDataForHistoryKey,
} from "@openbeacon/encryption";
import { accountNameSchema } from "../account/fields.ts";
import { sealedPersonalDataSchema } from "./personalData.ts";

const longestNames = ["語".repeat(100), "👨‍👩‍👧".repeat(12), "a".repeat(100)].map((name) =>
  accountNameSchema.parse(name),
);
const binding = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];

describe("sealedPersonalDataSchema", () => {
  test("accepts the largest nickname a phone can seal, in both envelope versions", () => {
    const historyKey = createHistoryKeyPair();
    const deviceKey = createDeviceKeyPair();
    for (const plaintext of longestNames) {
      for (const sealed of [
        sealPersonalDataForHistoryKey({
          historyKey: {
            publicKey: historyKey.publicKey,
            version: Number.MAX_SAFE_INTEGER,
          },
          purpose: "nickname",
          binding,
          plaintext,
        }),
        sealPersonalData({
          privateKey: deviceKey.privateKey,
          purpose: "nickname",
          binding,
          plaintext,
        }),
      ]) {
        expect(sealedPersonalDataSchema.safeParse(sealed).success).toBe(true);
      }
    }
  });

  test("refuses empty values and anything far beyond a sealed nickname", () => {
    expect(sealedPersonalDataSchema.safeParse("").success).toBe(false);
    expect(sealedPersonalDataSchema.safeParse("a".repeat(2049)).success).toBe(false);
    expect(sealedPersonalDataSchema.safeParse("a".repeat(50000)).success).toBe(false);
  });
});
