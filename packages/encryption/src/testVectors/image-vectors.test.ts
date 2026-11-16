import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { ImageKeyKind, ImagePurpose } from "../index.ts";
import {
  decryptImage,
  decryptImageKey,
  EpochKeyMaterial,
  decodeBase64,
  encodeBase64,
  encryptImageKey,
  IMAGE_ENCRYPTION_CONTEXT,
  IMAGE_ENCRYPTION_VERSION,
  ImageKeyMaterial,
  PAYLOAD_ENCRYPTION_ALGORITHM,
} from "../index.ts";
import { encryptImageWithKeyAndNonce } from "../image.ts";

const vectors = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "image-v1.json"), "utf8"),
) as {
  algorithm: string;
  constants: {
    epochDomainContext: string;
    epochKeyBase64: string;
    epochKeyHex: string;
    imageContext: string;
    imageKeyBase64: string;
    imageKeyHex: string;
    imageKeyNonceBase64: string;
    imageKeyNonceHex: string;
    imageKeyPurpose: string;
    imageNonceHex: string;
    imageVersion: number;
  };
  imageKeys: {
    aadJson: string;
    ciphertextBase64: string;
    metadata: {
      epochId: string;
      fileName: string;
      groupId: string;
      kind: ImageKeyKind;
      ownerId: string;
      senderDeviceId: string;
    };
    name: string;
    nonceBase64: string;
  }[];
  pictures: {
    aadJson: string;
    blobHex: string;
    fileName: string;
    name: string;
    ownerId: string;
    plaintextHex: string;
    purpose: ImagePurpose;
  }[];
  version: number;
};

const { constants } = vectors;
const imageKey = new ImageKeyMaterial(hexToBytes(constants.imageKeyHex));
const epochKey = new EpochKeyMaterial(hexToBytes(constants.epochKeyHex));

describe("image vectors", () => {
  test("vector file uses the locked algorithm, contexts and version", () => {
    expect(vectors.version).toBe(1);
    expect(vectors.algorithm).toBe(PAYLOAD_ENCRYPTION_ALGORITHM);
    expect(constants.imageContext).toBe(IMAGE_ENCRYPTION_CONTEXT);
    expect(IMAGE_ENCRYPTION_CONTEXT).toBe("openbeacon.image.v1");
    expect(constants.imageVersion).toBe(IMAGE_ENCRYPTION_VERSION);
    expect(IMAGE_ENCRYPTION_VERSION).toBe(1);
    expect(constants.epochDomainContext).toBe("openbeacon.group-epoch.v1");
    expect(constants.imageKeyPurpose).toBe("image-key");
  });

  test("vector file's base64 keys and nonce match their hex forms", () => {
    expect(encodeBase64(hexToBytes(constants.imageKeyHex))).toBe(constants.imageKeyBase64);
    expect(encodeBase64(hexToBytes(constants.epochKeyHex))).toBe(constants.epochKeyBase64);
    expect(encodeBase64(hexToBytes(constants.imageKeyNonceHex))).toBe(
      constants.imageKeyNonceBase64,
    );
  });

  test("encrypting each picture gives the committed blob", () => {
    for (const picture of vectors.pictures) {
      const { blob } = encryptImageWithKeyAndNonce({
        bytes: hexToBytes(picture.plaintextHex),
        fileName: picture.fileName,
        key: imageKey,
        nonce: hexToBytes(constants.imageNonceHex),
        ownerId: picture.ownerId,
        purpose: picture.purpose,
      });

      expect(bytesToHex(blob)).toBe(picture.blobHex);
      expect(picture.blobHex.slice(0, 2)).toBe("01");
      expect(picture.blobHex.slice(2, 50)).toBe(constants.imageNonceHex);
    }
  });

  test("decrypting each committed blob gives the picture", () => {
    for (const picture of vectors.pictures) {
      const bytes = decryptImage({
        blob: hexToBytes(picture.blobHex),
        fileName: picture.fileName,
        key: imageKey,
        ownerId: picture.ownerId,
        purpose: picture.purpose,
      });

      expect(bytesToHex(bytes)).toBe(picture.plaintextHex);
    }
  });

  test("encrypting each picture key gives the committed ciphertext", () => {
    for (const testCase of vectors.imageKeys) {
      const encrypted = encryptImageKey({
        ...testCase.metadata,
        epochKey,
        imageKey,
        nonce: hexToBytes(constants.imageKeyNonceHex),
      });

      expect(encrypted).toEqual({
        algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
        ciphertext: testCase.ciphertextBase64,
        epochId: testCase.metadata.epochId,
        nonce: testCase.nonceBase64,
        senderDeviceId: testCase.metadata.senderDeviceId,
      });
    }
  });

  test("decrypting each committed picture key gives the picture key", () => {
    for (const testCase of vectors.imageKeys) {
      const decrypted = decryptImageKey({
        encryptedKey: {
          algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
          ciphertext: testCase.ciphertextBase64,
          epochId: testCase.metadata.epochId,
          nonce: testCase.nonceBase64,
          senderDeviceId: testCase.metadata.senderDeviceId,
        },
        epochKey,
        fileName: testCase.metadata.fileName,
        groupId: testCase.metadata.groupId,
        kind: testCase.metadata.kind,
        ownerId: testCase.metadata.ownerId,
      });

      expect(bytesToHex(decrypted.expose())).toBe(constants.imageKeyHex);
    }
  });

  test("each aadJson is the exact associated data the ciphertext was sealed with", () => {
    const textEncoder = new TextEncoder();
    for (const picture of vectors.pictures) {
      const blob = hexToBytes(picture.blobHex);
      const plaintext = xchacha20poly1305(
        hexToBytes(constants.imageKeyHex),
        blob.subarray(1, 25),
        textEncoder.encode(picture.aadJson),
      ).decrypt(blob.subarray(25));

      expect(bytesToHex(plaintext)).toBe(picture.plaintextHex);
    }
    for (const testCase of vectors.imageKeys) {
      const plaintext = xchacha20poly1305(
        hexToBytes(constants.epochKeyHex),
        decodeBase64(testCase.nonceBase64),
        textEncoder.encode(testCase.aadJson),
      ).decrypt(decodeBase64(testCase.ciphertextBase64));

      expect(bytesToHex(plaintext)).toBe(constants.imageKeyHex);
    }
  });

  test("AAD JSON key order is locked byte-for-byte", () => {
    for (const picture of vectors.pictures) {
      expect(picture.aadJson).toBe(
        JSON.stringify({
          context: constants.imageContext,
          fileName: picture.fileName,
          ownerId: picture.ownerId,
          purpose: picture.purpose,
        }),
      );
    }
    for (const testCase of vectors.imageKeys) {
      expect(testCase.aadJson).toBe(
        JSON.stringify({
          context: constants.epochDomainContext,
          epochId: testCase.metadata.epochId,
          fileName: testCase.metadata.fileName,
          groupId: testCase.metadata.groupId,
          kind: testCase.metadata.kind,
          ownerId: testCase.metadata.ownerId,
          purpose: constants.imageKeyPurpose,
          senderDeviceId: testCase.metadata.senderDeviceId,
        }),
      );
    }
  });
});
