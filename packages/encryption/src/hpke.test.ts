import { describe, expect, test } from "bun:test";
import { x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { openAuth, openBase, sealAuth, sealBase } from "./hpke.ts";

const rfc9180AuthVector = {
  aad: hexToBytes("436f756e742d30"),
  ciphertext: hexToBytes(
    "ab1a13c9d4f01a87ec3440dbd756e2677bd2ecf9df0ce7ed73869b98e00c09be111cb9fdf077347aeb88e61bdf",
  ),
  enc: hexToBytes("f7674cc8cd7baa5872d1f33dbaffe3314239f6197ddf5ded1746760bfc847e0e"),
  ephemeralPrivateKey: hexToBytes(
    "c94619e1af28971c8fa7957192b7e62a71ca2dcdde0a7cc4a8a9e741d600ab13",
  ),
  info: hexToBytes("4f6465206f6e2061204772656369616e2055726e"),
  plaintext: hexToBytes("4265617574792069732074727574682c20747275746820626561757479"),
  recipientPrivateKey: hexToBytes(
    "3ca22a6d1cda1bb9480949ec5329d3bf0b080ca4c45879c95eddb55c70b80b82",
  ),
  recipientPublicKey: hexToBytes(
    "1a478716d63cb2e16786ee93004486dc151e988b34b475043d3e0175bdb01c44",
  ),
  senderPrivateKey: hexToBytes("2def0cb58ffcf83d1062dd085c8aceca7f4c0c3fd05912d847b61f3e54121f05"),
  senderPublicKey: hexToBytes("f0f4f9e96c54aeed3f323de8534fffd7e0577e4ce269896716bcb95643c8712b"),
};

const rfc9180BaseVector = {
  aad: hexToBytes("436f756e742d30"),
  ciphertext: hexToBytes(
    "1c5250d8034ec2b784ba2cfd69dbdb8af406cfe3ff938e131f0def8c8b60b4db21993c62ce81883d2dd1b51a28",
  ),
  enc: hexToBytes("1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a"),
  ephemeralPrivateKey: hexToBytes(
    "f4ec9b33b792c372c1d2c2063507b684ef925b8c75a42dbcbf57d63ccd381600",
  ),
  info: hexToBytes("4f6465206f6e2061204772656369616e2055726e"),
  plaintext: hexToBytes("4265617574792069732074727574682c20747275746820626561757479"),
  recipientPrivateKey: hexToBytes(
    "8057991eef8f1f1af18f4a9491d16a1ce333f695d4db8e38da75975c4478e0fb",
  ),
  recipientPublicKey: hexToBytes(
    "4310ee97d88cc1f088a5576c77ab0cf5c3ac797f3d95139c6c84b5429c59662a",
  ),
};

const createKeyPair = () => {
  const { publicKey, secretKey } = x25519.keygen();
  return { privateKey: secretKey, publicKey };
};

const sealForRecipient = (
  sender: ReturnType<typeof createKeyPair>,
  recipient: ReturnType<typeof createKeyPair>,
) =>
  sealAuth({
    aad: new Uint8Array([1]),
    info: new Uint8Array([2]),
    plaintext: new Uint8Array([3, 4, 5]),
    recipientPublicKey: recipient.publicKey,
    senderPrivateKey: sender.privateKey,
  });

describe("HPKE auth mode", () => {
  test("matches the RFC 9180 DHKEM(X25519)/HKDF-SHA256/ChaCha20Poly1305 auth vector", () => {
    const sealed = sealAuth(rfc9180AuthVector);

    expect(bytesToHex(sealed.enc)).toBe(bytesToHex(rfc9180AuthVector.enc));
    expect(bytesToHex(sealed.ciphertext)).toBe(bytesToHex(rfc9180AuthVector.ciphertext));
    expect(bytesToHex(openAuth(rfc9180AuthVector))).toBe(bytesToHex(rfc9180AuthVector.plaintext));
  });

  test("uses a fresh ephemeral key for every seal", () => {
    const sender = createKeyPair();
    const recipient = createKeyPair();

    expect(bytesToHex(sealForRecipient(sender, recipient).enc)).not.toBe(
      bytesToHex(sealForRecipient(sender, recipient).enc),
    );
  });

  test("rejects a ciphertext that claims a different sender", () => {
    const sender = createKeyPair();
    const impostor = createKeyPair();
    const recipient = createKeyPair();
    const sealed = sealForRecipient(sender, recipient);

    expect(() =>
      openAuth({
        aad: new Uint8Array([1]),
        ciphertext: sealed.ciphertext,
        enc: sealed.enc,
        info: new Uint8Array([2]),
        recipientPrivateKey: recipient.privateKey,
        senderPublicKey: impostor.publicKey,
      }),
    ).toThrow();
  });

  test("rejects a ciphertext sealed by a sender who is not the claimed sender", () => {
    const claimedSender = createKeyPair();
    const forger = createKeyPair();
    const recipient = createKeyPair();
    const sealed = sealForRecipient(forger, recipient);

    expect(() =>
      openAuth({
        aad: new Uint8Array([1]),
        ciphertext: sealed.ciphertext,
        enc: sealed.enc,
        info: new Uint8Array([2]),
        recipientPrivateKey: recipient.privateKey,
        senderPublicKey: claimedSender.publicKey,
      }),
    ).toThrow();
  });

  test("rejects a changed ephemeral key, info or aad", () => {
    const sender = createKeyPair();
    const recipient = createKeyPair();
    const sealed = sealForRecipient(sender, recipient);
    const valid = {
      aad: new Uint8Array([1]),
      ciphertext: sealed.ciphertext,
      enc: sealed.enc,
      info: new Uint8Array([2]),
      recipientPrivateKey: recipient.privateKey,
      senderPublicKey: sender.publicKey,
    };

    expect(openAuth(valid)).toEqual(new Uint8Array([3, 4, 5]));
    expect(() => openAuth({ ...valid, enc: createKeyPair().publicKey })).toThrow();
    expect(() => openAuth({ ...valid, info: new Uint8Array([9]) })).toThrow();
    expect(() => openAuth({ ...valid, aad: new Uint8Array([9]) })).toThrow();
  });

  test("rejects low-order ephemeral keys", () => {
    const sender = createKeyPair();
    const recipient = createKeyPair();
    const sealed = sealForRecipient(sender, recipient);

    expect(() =>
      openAuth({
        aad: new Uint8Array([1]),
        ciphertext: sealed.ciphertext,
        enc: new Uint8Array(32),
        info: new Uint8Array([2]),
        recipientPrivateKey: recipient.privateKey,
        senderPublicKey: sender.publicKey,
      }),
    ).toThrow();
  });
});

describe("HPKE base mode", () => {
  test("matches the RFC 9180 DHKEM(X25519)/HKDF-SHA256/ChaCha20Poly1305 base vector", () => {
    const sealed = sealBase(rfc9180BaseVector);

    expect(bytesToHex(sealed.enc)).toBe(bytesToHex(rfc9180BaseVector.enc));
    expect(bytesToHex(sealed.ciphertext)).toBe(bytesToHex(rfc9180BaseVector.ciphertext));
    expect(bytesToHex(openBase(rfc9180BaseVector))).toBe(bytesToHex(rfc9180BaseVector.plaintext));
  });

  test("rejects the wrong recipient key, a changed ephemeral key, info or aad", () => {
    const recipient = createKeyPair();
    const sealed = sealBase({
      aad: new Uint8Array([1]),
      info: new Uint8Array([2]),
      plaintext: new Uint8Array([3, 4, 5]),
      recipientPublicKey: recipient.publicKey,
    });
    const valid = {
      aad: new Uint8Array([1]),
      ciphertext: sealed.ciphertext,
      enc: sealed.enc,
      info: new Uint8Array([2]),
      recipientPrivateKey: recipient.privateKey,
    };

    expect(openBase(valid)).toEqual(new Uint8Array([3, 4, 5]));
    expect(() => openBase({ ...valid, recipientPrivateKey: createKeyPair().privateKey })).toThrow();
    expect(() => openBase({ ...valid, enc: createKeyPair().publicKey })).toThrow();
    expect(() => openBase({ ...valid, enc: new Uint8Array(32) })).toThrow();
    expect(() => openBase({ ...valid, info: new Uint8Array([9]) })).toThrow();
    expect(() => openBase({ ...valid, aad: new Uint8Array([9]) })).toThrow();
  });
});
