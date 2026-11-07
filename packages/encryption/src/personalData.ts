import { x25519 } from "@noble/curves/ed25519.js";
import { z } from "zod";
import { decodeBase64, encodeBase64 } from "./base64.ts";
import { openBase, sealBase } from "./hpke.ts";
import type { DevicePrivateKeyMaterial, HistoryPrivateKeyMaterial } from "./sensitive.ts";
import type { HistoryPublicKey, PersonalDataPurpose } from "./types.ts";

const encoder = new TextEncoder();
const getInfo = (
  context: ["openbeacon.personal-data.v2"] | ["openbeacon.personal-data.v3", number],
  purpose: PersonalDataPurpose,
  binding: string[],
) => encoder.encode(JSON.stringify([...context, purpose, ...binding]));

const envelopeSchema = z.discriminatedUnion("version", [
  z.object({
    version: z.literal(2),
    enc: z.string(),
    ciphertext: z.string(),
  }),
  z.object({
    version: z.literal(3),
    historyKeyVersion: z.number().int().positive(),
    enc: z.string(),
    ciphertext: z.string(),
  }),
]);

export const sealPersonalData = ({
  privateKey,
  purpose,
  binding,
  plaintext,
}: {
  privateKey: DevicePrivateKeyMaterial;
  purpose: PersonalDataPurpose;
  binding: string[];
  plaintext: string;
}) => {
  const sealed = sealBase({
    aad: new Uint8Array(),
    info: getInfo(["openbeacon.personal-data.v2"], purpose, binding),
    plaintext: encoder.encode(plaintext),
    recipientPublicKey: x25519.getPublicKey(privateKey.expose()),
  });
  return JSON.stringify({
    version: 2,
    enc: encodeBase64(sealed.enc),
    ciphertext: encodeBase64(sealed.ciphertext),
  } satisfies z.infer<typeof envelopeSchema>);
};

export const sealPersonalDataForHistoryKey = ({
  historyKey,
  purpose,
  binding,
  plaintext,
}: {
  historyKey: Pick<HistoryPublicKey, "publicKey" | "version">;
  purpose: PersonalDataPurpose;
  binding: string[];
  plaintext: string;
}) => {
  const sealed = sealBase({
    aad: new Uint8Array(),
    info: getInfo(["openbeacon.personal-data.v3", historyKey.version], purpose, binding),
    plaintext: encoder.encode(plaintext),
    recipientPublicKey: decodeBase64(historyKey.publicKey),
  });
  return JSON.stringify({
    version: 3,
    historyKeyVersion: historyKey.version,
    enc: encodeBase64(sealed.enc),
    ciphertext: encodeBase64(sealed.ciphertext),
  } satisfies z.infer<typeof envelopeSchema>);
};

export const openPersonalData = ({
  privateKey,
  historyPrivateKeys = new Map(),
  purpose,
  binding,
  sealed,
}: {
  privateKey: DevicePrivateKeyMaterial;
  historyPrivateKeys?: ReadonlyMap<number, HistoryPrivateKeyMaterial>;
  purpose: PersonalDataPurpose;
  binding: string[];
  sealed: string;
}) => {
  const envelope = envelopeSchema.parse(JSON.parse(sealed));
  const opening =
    envelope.version === 2
      ? {
          info: getInfo(["openbeacon.personal-data.v2"], purpose, binding),
          recipientPrivateKey: privateKey,
        }
      : {
          info: getInfo(
            ["openbeacon.personal-data.v3", envelope.historyKeyVersion],
            purpose,
            binding,
          ),
          recipientPrivateKey: historyPrivateKeys.get(envelope.historyKeyVersion),
        };

  if (opening.recipientPrivateKey === undefined) {
    throw new Error("Missing history key for personal data.");
  }

  return new TextDecoder().decode(
    openBase({
      aad: new Uint8Array(),
      ciphertext: decodeBase64(envelope.ciphertext),
      enc: decodeBase64(envelope.enc),
      info: opening.info,
      recipientPrivateKey: opening.recipientPrivateKey.expose(),
    }),
  );
};
