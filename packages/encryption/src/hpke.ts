import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { expand, extract } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";

const textEncoder = new TextEncoder();
const HPKE_VERSION_LABEL = textEncoder.encode("HPKE-v1");
const KEM_ID = 0x0020;

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

const createAuthModeCipher = (sharedSecret: Uint8Array, info: Uint8Array, aad: Uint8Array) => {
  const empty = new Uint8Array();
  const keyScheduleContext = concatBytes(
    i2osp(0x02, 1),
    labeledExtract(HPKE_SUITE_ID, empty, "psk_id_hash", empty),
    labeledExtract(HPKE_SUITE_ID, empty, "info_hash", info),
  );
  const secret = labeledExtract(HPKE_SUITE_ID, sharedSecret, "secret", empty);

  return chacha20poly1305(
    labeledExpand(HPKE_SUITE_ID, secret, "key", keyScheduleContext, 32),
    labeledExpand(HPKE_SUITE_ID, secret, "base_nonce", keyScheduleContext, 12),
    aad,
  );
};

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
  const enc = x25519.getPublicKey(ephemeralPrivateKey);
  const sharedSecret = deriveKemSharedSecret(
    concatBytes(
      x25519.getSharedSecret(ephemeralPrivateKey, recipientPublicKey),
      x25519.getSharedSecret(senderPrivateKey, recipientPublicKey),
    ),
    concatBytes(enc, recipientPublicKey, x25519.getPublicKey(senderPrivateKey)),
  );

  return {
    ciphertext: createAuthModeCipher(sharedSecret, info, aad).encrypt(plaintext),
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
  const sharedSecret = deriveKemSharedSecret(
    concatBytes(
      x25519.getSharedSecret(recipientPrivateKey, enc),
      x25519.getSharedSecret(recipientPrivateKey, senderPublicKey),
    ),
    concatBytes(enc, x25519.getPublicKey(recipientPrivateKey), senderPublicKey),
  );

  return createAuthModeCipher(sharedSecret, info, aad).decrypt(ciphertext);
};
