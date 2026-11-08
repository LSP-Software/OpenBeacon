import { describe, expect, test } from "bun:test";
import {
  DevicePrivateKeyMaterial,
  EpochKeyMaterial,
  HistoryPrivateKeyMaterial,
  RecoveryPhrase,
  RecoveryPrivateKeyMaterial,
  SensitivePayloadBytes,
} from "./sensitive.ts";

const secretBytes = new Uint8Array([1, 2, 3, 250, 251, 252]);

describe.each([
  ["epoch key", EpochKeyMaterial],
  ["payload", SensitivePayloadBytes],
  ["device private key", DevicePrivateKeyMaterial],
  ["recovery phrase", RecoveryPhrase],
  ["recovery private key", RecoveryPrivateKeyMaterial],
  ["history private key", HistoryPrivateKeyMaterial],
] as const)("%s wrapper", (label, Wrapper) => {
  test("never serialises its bytes", () => {
    const value = new Wrapper(secretBytes);

    expect(JSON.stringify({ value })).toBe(`{"value":"[REDACTED ${label}]"}`);
    expect(String(value)).toBe(`[REDACTED ${label}]`);
    expect(`${value}`).toBe(`[REDACTED ${label}]`);
  });

  test("hands out copies so callers cannot alter the stored bytes", () => {
    const value = new Wrapper(secretBytes);

    value.expose().fill(0);

    expect(value.expose()).toEqual(secretBytes);
  });
});

describe("recovery phrase", () => {
  test("splits the phrase into words", () => {
    const phrase = new RecoveryPhrase(new TextEncoder().encode("alpha beta gamma"));

    expect(phrase.words()).toEqual(["alpha", "beta", "gamma"]);
  });
});
