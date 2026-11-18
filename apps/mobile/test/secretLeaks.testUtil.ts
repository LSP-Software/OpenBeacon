import { encodeBase64, type RecoveryPhrase } from "@openbeacon/encryption";
import { expect } from "bun:test";

const WINDOW_BYTES = 9;

const serialize = (value: unknown) =>
  typeof value === "string"
    ? value
    : JSON.stringify(value, (_key, item: unknown) => {
        if (item instanceof ArrayBuffer) return Array.from(new Uint8Array(item));
        if (ArrayBuffer.isView(item)) {
          return Array.from(new Uint8Array(item.buffer, item.byteOffset, item.byteLength));
        }
        if (item instanceof Map) return [...item.entries()];
        if (item instanceof Set) return [...item.values()];
        return item;
      });

const windowsOf = (secret: Uint8Array) =>
  secret.length <= WINDOW_BYTES
    ? [secret]
    : Array.from({ length: secret.length - WINDOW_BYTES + 1 }, (_, start) =>
        secret.subarray(start, start + WINDOW_BYTES),
      );

export const expectNoSecretsIn = (
  value: unknown,
  { secrets, phrases }: { secrets: Uint8Array[]; phrases: RecoveryPhrase[] },
) => {
  const serialized = serialize(value);
  const lowerCase = serialized.toLowerCase();
  const lettersOnly = lowerCase.replace(/[^a-z]/g, "");
  const letterRuns = lowerCase.match(/[a-z]+/g) ?? [];
  for (const secret of secrets) {
    expect(serialized).not.toContain(encodeBase64(secret));
    for (const window of windowsOf(secret)) {
      const bytes = Buffer.from(window);
      expect(serialized).not.toContain(bytes.toString("base64").replace(/=+$/, ""));
      expect(serialized).not.toContain(bytes.toString("base64url"));
      expect(lowerCase).not.toContain(bytes.toString("hex"));
      expect(serialized).not.toMatch(
        new RegExp(`(?<![0-9])${Array.from(window).join("\\s*,\\s*")}(?![0-9])`),
      );
    }
  }
  for (const phrase of phrases) {
    const phraseWords = phrase.words().map((word) => word.toLowerCase());
    expect(lettersOnly).not.toContain(phraseWords.join(""));
    const wordsInOrder = letterRuns.reduce(
      (found, run) => (run === phraseWords[found] ? found + 1 : found),
      0,
    );
    expect(wordsInOrder).toBeLessThan(phraseWords.length);
    for (const word of phrase.words()) {
      expect(serialized).not.toMatch(
        new RegExp(`(?<![A-Za-z0-9+/_:-])${word}(?![A-Za-z0-9+/=_-]|\\\\*":)`),
      );
    }
  }
  expect(serialized).not.toContain("REDACTED");
};
