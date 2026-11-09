import { encodeBase64, type RecoveryPhrase } from "@openbeacon/encryption";
import { expect } from "bun:test";

export const expectNoSecretsIn = (
  serialized: string,
  { secrets, phrases }: { secrets: Uint8Array[]; phrases: RecoveryPhrase[] },
) => {
  for (const secret of secrets) {
    expect(serialized).not.toContain(encodeBase64(secret));
    expect(serialized).not.toContain(Buffer.from(secret).toString("base64url"));
    expect(serialized).not.toContain(Buffer.from(secret).toString("hex"));
    expect(serialized).not.toContain(JSON.stringify(Array.from(secret)).slice(1, -1));
  }
  for (const phrase of phrases) {
    expect(serialized).not.toContain(phrase.words().join(" "));
    for (const word of phrase.words()) {
      expect(serialized).not.toMatch(
        new RegExp(`(?<![A-Za-z0-9+/_-])${word}(?![A-Za-z0-9+/=_-]|":)`),
      );
    }
  }
  expect(serialized).not.toContain("REDACTED");
};
