import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { expand, extract } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";

const textEncoder = new TextEncoder();
const HPKE_VERSION_LABEL = textEncoder.encode("HPKE-v1");
const KEM_ID = 0x0020;
const BASE_MODE = 0x00;
const AUTH_MODE = 0x02;
const AUTH_PSK_MODE = 0x03;

const i2osp = (value: number, length: number) => {
  const bytes = new Uint8Array(length);
  for (let index = length - 1, remaining = value; index >= 0; index -= 1, remaining >>>= 8) {
    bytes[index] = remaining & 0xff;
  }
  return bytes;
};

const KEM_SUITE_ID = concatBytes(textEncoder.encode("KEM"), i2osp(KEM_ID, 2));
const HPKE_SUITE_ID = concatBytes(
  textEncoder.encode("HPKE"),
  i2osp(KEM_ID, 2),
  i2osp(0x0001, 2),
  i2osp(0x0003, 2),
);

const labeledExtract = (suiteId: Uint8Array, salt: Uint8Array, label: string, ikm: Uint8Array) =>
  extract(sha256, concatBytes(HPKE_VERSION_LABEL, suiteId, textEncoder.encode(label), ikm), salt);

const labeledExpand = (
  suiteId: Uint8Array,
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
) =>
  expand(
    sha256,
    prk,
    concatBytes(i2osp(length, 2), HPKE_VERSION_LABEL, suiteId, textEncoder.encode(label), info),
    length,
  );

const deriveKemSharedSecret = (dh: Uint8Array, kemContext: Uint8Array) =>
  labeledExpand(
    KEM_SUITE_ID,
    labeledExtract(KEM_SUITE_ID, new Uint8Array(), "eae_prk", dh),
    "shared_secret",
    kemContext,
    32,
  );

const createCipher = ({
  aad,
  info,
  mode,
  psk = new Uint8Array(),
  pskId = new Uint8Array(),
  sharedSecret,
}: {
  aad: Uint8Array;
  info: Uint8Array;
  mode: typeof BASE_MODE | typeof AUTH_MODE | typeof AUTH_PSK_MODE;
  psk?: Uint8Array;
  pskId?: Uint8Array;
  sharedSecret: Uint8Array;
}) => {
  const usesPsk = mode === AUTH_PSK_MODE;
  if (usesPsk !== psk.length > 0 || usesPsk !== pskId.length > 0) {
    throw new Error("Inconsistent HPKE PSK inputs.");
  }
  if (usesPsk && psk.length < 32) {
    throw new Error("HPKE PSK is too short.");
  }
  const empty = new Uint8Array();
  const keyScheduleContext = concatBytes(
    i2osp(mode, 1),
    labeledExtract(HPKE_SUITE_ID, empty, "psk_id_hash", pskId),
    labeledExtract(HPKE_SUITE_ID, empty, "info_hash", info),
  );
  const secret = labeledExtract(HPKE_SUITE_ID, sharedSecret, "secret", psk);

  return chacha20poly1305(
    labeledExpand(HPKE_SUITE_ID, secret, "key", keyScheduleContext, 32),
    labeledExpand(HPKE_SUITE_ID, secret, "base_nonce", keyScheduleContext, 12),
    aad,
  );
};

const encapsulateAuth = ({
  ephemeralPrivateKey,
  recipientPublicKey,
  senderPrivateKey,
}: {
  ephemeralPrivateKey: Uint8Array;
  recipientPublicKey: Uint8Array;
  senderPrivateKey: Uint8Array;
}) => {
  const enc = x25519.getPublicKey(ephemeralPrivateKey);
  return {
    enc,
    sharedSecret: deriveKemSharedSecret(
      concatBytes(
        x25519.getSharedSecret(ephemeralPrivateKey, recipientPublicKey),
        x25519.getSharedSecret(senderPrivateKey, recipientPublicKey),
      ),
      concatBytes(enc, recipientPublicKey, x25519.getPublicKey(senderPrivateKey)),
    ),
  };
};

const decapsulateAuth = ({
  enc,
  recipientPrivateKey,
  senderPublicKey,
}: {
  enc: Uint8Array;
  recipientPrivateKey: Uint8Array;
  senderPublicKey: Uint8Array;
}) =>
  deriveKemSharedSecret(
    concatBytes(
      x25519.getSharedSecret(recipientPrivateKey, enc),
      x25519.getSharedSecret(recipientPrivateKey, senderPublicKey),
    ),
    concatBytes(enc, x25519.getPublicKey(recipientPrivateKey), senderPublicKey),
  );

export const sealAuth = ({
  aad,
  ephemeralPrivateKey = x25519.utils.randomSecretKey(),
  info,
  plaintext,
  recipientPublicKey,
  senderPrivateKey,
}: {
  aad: Uint8Array;
  ephemeralPrivateKey?: Uint8Array;
  info: Uint8Array;
  plaintext: Uint8Array;
  recipientPublicKey: Uint8Array;
  senderPrivateKey: Uint8Array;
}) => {
  const { enc, sharedSecret } = encapsulateAuth({
    ephemeralPrivateKey,
    recipientPublicKey,
    senderPrivateKey,
  });

  return {
    ciphertext: createCipher({ aad, info, mode: AUTH_MODE, sharedSecret }).encrypt(plaintext),
    enc,
  };
};

export const openAuth = ({
  aad,
  ciphertext,
  enc,
  info,
  recipientPrivateKey,
  senderPublicKey,
}: {
  aad: Uint8Array;
  ciphertext: Uint8Array;
  enc: Uint8Array;
  info: Uint8Array;
  recipientPrivateKey: Uint8Array;
  senderPublicKey: Uint8Array;
}) => {
  const sharedSecret = decapsulateAuth({ enc, recipientPrivateKey, senderPublicKey });

  return createCipher({ aad, info, mode: AUTH_MODE, sharedSecret }).decrypt(ciphertext);
};

export const sealAuthPsk = ({
  aad,
  ephemeralPrivateKey = x25519.utils.randomSecretKey(),
  info,
  plaintext,
  psk,
  pskId,
  recipientPublicKey,
  senderPrivateKey,
}: {
  aad: Uint8Array;
  ephemeralPrivateKey?: Uint8Array;
  info: Uint8Array;
  plaintext: Uint8Array;
  psk: Uint8Array;
  pskId: Uint8Array;
  recipientPublicKey: Uint8Array;
  senderPrivateKey: Uint8Array;
}) => {
  const { enc, sharedSecret } = encapsulateAuth({
    ephemeralPrivateKey,
    recipientPublicKey,
    senderPrivateKey,
  });

  return {
    ciphertext: createCipher({
      aad,
      info,
      mode: AUTH_PSK_MODE,
      psk,
      pskId,
      sharedSecret,
    }).encrypt(plaintext),
    enc,
  };
};

export const openAuthPsk = ({
  aad,
  ciphertext,
  enc,
  info,
  psk,
  pskId,
  recipientPrivateKey,
  senderPublicKey,
}: {
  aad: Uint8Array;
  ciphertext: Uint8Array;
  enc: Uint8Array;
  info: Uint8Array;
  psk: Uint8Array;
  pskId: Uint8Array;
  recipientPrivateKey: Uint8Array;
  senderPublicKey: Uint8Array;
}) => {
  const sharedSecret = decapsulateAuth({ enc, recipientPrivateKey, senderPublicKey });

  return createCipher({
    aad,
    info,
    mode: AUTH_PSK_MODE,
    psk,
    pskId,
    sharedSecret,
  }).decrypt(ciphertext);
};

export const sealBase = ({
  aad,
  ephemeralPrivateKey = x25519.utils.randomSecretKey(),
  info,
  plaintext,
  recipientPublicKey,
}: {
  aad: Uint8Array;
  ephemeralPrivateKey?: Uint8Array;
  info: Uint8Array;
  plaintext: Uint8Array;
  recipientPublicKey: Uint8Array;
}) => {
  const enc = x25519.getPublicKey(ephemeralPrivateKey);
  const sharedSecret = deriveKemSharedSecret(
    x25519.getSharedSecret(ephemeralPrivateKey, recipientPublicKey),
    concatBytes(enc, recipientPublicKey),
  );

  return {
    ciphertext: createCipher({ aad, info, mode: BASE_MODE, sharedSecret }).encrypt(plaintext),
    enc,
  };
};

export const openBase = ({
  aad,
  ciphertext,
  enc,
  info,
  recipientPrivateKey,
}: {
  aad: Uint8Array;
  ciphertext: Uint8Array;
  enc: Uint8Array;
  info: Uint8Array;
  recipientPrivateKey: Uint8Array;
}) => {
  const sharedSecret = deriveKemSharedSecret(
    x25519.getSharedSecret(recipientPrivateKey, enc),
    concatBytes(enc, x25519.getPublicKey(recipientPrivateKey)),
  );

  return createCipher({ aad, info, mode: BASE_MODE, sharedSecret }).decrypt(ciphertext);
};
