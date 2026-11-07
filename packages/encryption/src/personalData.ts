import { x25519 } from "@noble/curves/ed25519.js";
import { z } from "zod";
import { decodeBase64, encodeBase64 } from "./base64.ts";
import { openBase, sealBase } from "./hpke.ts";
import type { DevicePrivateKeyMaterial } from "./sensitive.ts";
import type { PersonalDataPurpose } from "./types.ts";

const encoder = new TextEncoder();
const getInfo = (purpose: PersonalDataPurpose, binding: string[]) =>
  encoder.encode(JSON.stringify(["openbeacon.personal-data.v2", purpose, ...binding]));

const envelopeSchema = z.object({
  version: z.literal(2),
  enc: z.string(),
  ciphertext: z.string(),
});

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
    info: getInfo(purpose, binding),
    plaintext: encoder.encode(plaintext),
    recipientPublicKey: x25519.getPublicKey(privateKey.expose()),
  });
  return JSON.stringify({
    version: 2,
    enc: encodeBase64(sealed.enc),
    ciphertext: encodeBase64(sealed.ciphertext),
  } satisfies z.infer<typeof envelopeSchema>);
};

export const openPersonalData = ({
  privateKey,
  purpose,
  binding,
  sealed,
}: {
  privateKey: DevicePrivateKeyMaterial;
  purpose: PersonalDataPurpose;
  binding: string[];
  sealed: string;
}) => {
  const envelope = envelopeSchema.parse(JSON.parse(sealed));
  return new TextDecoder().decode(
    openBase({
      aad: new Uint8Array(),
      ciphertext: decodeBase64(envelope.ciphertext),
      enc: decodeBase64(envelope.enc),
      info: getInfo(purpose, binding),
      recipientPrivateKey: privateKey.expose(),
    }),
  );
};
