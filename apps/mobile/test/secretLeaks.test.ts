import { describe, expect, test } from "bun:test";
import { encodeBase64, generateRecoveryPhrase } from "@openbeacon/encryption";
import { expectNoSecretsIn } from "./secretLeaks.testUtil.ts";

const key = Uint8Array.from({ length: 32 }, (_, index) => (index * 37 + 171) % 256);
const phrase = generateRecoveryPhrase();
const words = phrase.words();

describe("expectNoSecretsIn", () => {
  test("passes input that holds no secret", () => {
    expect(() =>
      expectNoSecretsIn(
        { groupId: "group-1", ciphertext: encodeBase64(new Uint8Array(32).fill(7)) },
        { secrets: [key], phrases: [phrase] },
      ),
    ).not.toThrow();
  });

  test.each([
    ["a raw Uint8Array", { privateKey: key }],
    ["a typed array view on a larger buffer", { privateKey: new Uint16Array(key.buffer) }],
    ["an ArrayBuffer", { privateKey: key.buffer }],
    ["a key inside a Map", { keys: new Map([["epoch", key]]) }],
    ["a Buffer", { privateKey: Buffer.from(key) }],
    ["base64", { privateKey: encodeBase64(key) }],
    ["base64 without padding", { privateKey: encodeBase64(key).replace(/=+$/, "") }],
    ["base64url", { privateKey: Buffer.from(key).toString("base64url") }],
    ["lower-case hex", { privateKey: Buffer.from(key).toString("hex") }],
    ["upper-case hex", { privateKey: Buffer.from(key).toString("hex").toUpperCase() }],
    ["a number list with spaces", `bytes: ${Array.from(key).join(", ")}`],
    ["the first half in base64", { privateKey: encodeBase64(key.subarray(0, 16)) }],
    ["the second half in base64", { privateKey: encodeBase64(key.subarray(16)) }],
    ["an odd slice in hex", { privateKey: Buffer.from(key.subarray(5, 17)).toString("hex") }],
    ["the phrase", { phrase: words.join(" ") }],
    ["the phrase in upper case", { phrase: words.join(" ").toUpperCase() }],
    ["the phrase joined by dashes", { phrase: words.join("-") }],
    ["the phrase joined by underscores", { phrase: words.join("_") }],
    ["the phrase joined by nothing", { phrase: words.join("") }],
    ["the phrase as an array", { phrase: words }],
    ["the phrase words as object keys", words.map((word) => ({ [word]: true }))],
    ["a redacted key object", { privateKey: "[REDACTED]" }],
  ])("catches %s", (_name, leak) => {
    expect(() => expectNoSecretsIn(leak, { secrets: [key], phrases: [phrase] })).toThrow();
  });
});
