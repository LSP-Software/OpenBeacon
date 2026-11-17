import { describe, expect, test } from "bun:test";
import { PAYLOAD_ENCRYPTION_ALGORITHM } from "@openbeacon/encryption";
import {
  confirmProfileImageUploadSchema,
  MAX_IMAGE_KEY_REENCRYPTS,
  reEncryptImageKeysSchema,
  storeImageKeySchema,
} from "./imageKeys.ts";

const key = {
  algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
  ciphertext: Buffer.alloc(48, 1).toString("base64"),
  epochId: "epoch-1",
  nonce: Buffer.alloc(24, 2).toString("base64"),
  senderDeviceId: "device-1",
};
const fileName = crypto.randomUUID();
const reEncryptKey = (memberId?: string) => ({
  target: memberId ? { kind: "member" as const, memberId } : { kind: "group" as const },
  fileName,
  expectedCiphertext: key.ciphertext,
  key,
});

describe("picture key schemas", () => {
  test("only accept the file names the server hands out", () => {
    expect(storeImageKeySchema.safeParse({ groupId: "g", fileName, key }).success).toBe(true);
    for (const name of [`${fileName}.webp`, "../avatar", fileName.toUpperCase()]) {
      expect(storeImageKeySchema.safeParse({ groupId: "g", fileName: name, key }).success).toBe(
        false,
      );
    }
  });

  test("refuse keys with another algorithm or a malformed nonce", () => {
    for (const changed of [
      { ...key, algorithm: "AES-GCM" },
      { ...key, nonce: "short" },
      { ...key, ciphertext: "a".repeat(129) },
    ]) {
      expect(storeImageKeySchema.safeParse({ groupId: "g", fileName, key: changed }).success).toBe(
        false,
      );
    }
  });

  test("each group gets at most one profile picture key", () => {
    expect(
      confirmProfileImageUploadSchema.safeParse({
        wraps: [
          { groupId: "g", ...key },
          { groupId: "g", ...key },
        ],
      }).success,
    ).toBe(false);
    expect(confirmProfileImageUploadSchema.safeParse({ wraps: [] }).success).toBe(true);
  });

  test("each key is re-encrypted once per request, within the batch limit", () => {
    const parse = (keys: ReturnType<typeof reEncryptKey>[]) =>
      reEncryptImageKeysSchema.safeParse({ groupId: "g", keys }).success;
    expect(parse([reEncryptKey(), reEncryptKey("m1")])).toBe(true);
    expect(parse([reEncryptKey(), reEncryptKey()])).toBe(false);
    expect(parse([reEncryptKey("m1"), reEncryptKey("m1")])).toBe(false);
    expect(parse([])).toBe(false);
    expect(
      parse(
        Array.from({ length: MAX_IMAGE_KEY_REENCRYPTS + 1 }, (_, index) =>
          reEncryptKey(`m${index}`),
        ),
      ),
    ).toBe(false);
  });
});
