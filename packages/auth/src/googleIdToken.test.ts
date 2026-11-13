import { afterAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { createGoogleIdTokenVerifier } from "./googleIdToken.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };

const certsServer = Bun.serve({ port: 0, fetch: () => Response.json({ keys: [jwk] }) });
const hangingServer = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: { data: () => {} },
});

afterAll(() => {
  certsServer.stop(true);
  hangingServer.stop(true);
});

const idToken = (claims: Record<string, unknown>) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const message = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode({
    iss: "https://accounts.google.com",
    aud: "client-id",
    sub: "google-subject",
    iat: now,
    exp: now + 300,
    ...claims,
  })}`;
  return `${message}.${sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64url")}`;
};

describe("Google ID token verification", () => {
  const verify = createGoogleIdTokenVerifier({
    certsUrl: new URL(`http://127.0.0.1:${certsServer.port.toString()}/certs`),
    timeoutMs: 1_000,
  });

  test("accepts a token Google signed for this client", async () => {
    expect(await verify({ token: idToken({}), audience: "client-id" })).toMatchObject({
      sub: "google-subject",
    });
    expect(
      await verify({ token: idToken({ iss: "accounts.google.com" }), audience: "client-id" }),
    ).toMatchObject({ sub: "google-subject" });
  });

  test("rejects a token for another client or issuer", async () => {
    expect(await verify({ token: idToken({ aud: "other" }), audience: "client-id" })).toBeNull();
    expect(
      await verify({ token: idToken({ iss: "https://evil.example" }), audience: "client-id" }),
    ).toBeNull();
  });

  test("rejects an expired token or one issued over an hour ago", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(
      await verify({ token: idToken({ iat: now - 600, exp: now - 300 }), audience: "client-id" }),
    ).toBeNull();
    expect(
      await verify({ token: idToken({ iat: now - 3_700, exp: now + 300 }), audience: "client-id" }),
    ).toBeNull();
  });

  test("checks the nonce when one is expected", async () => {
    expect(
      await verify({ token: idToken({ nonce: "nonce" }), audience: "client-id", nonce: "nonce" }),
    ).toMatchObject({ sub: "google-subject" });
    expect(
      await verify({ token: idToken({ nonce: "other" }), audience: "client-id", nonce: "nonce" }),
    ).toBeNull();
    expect(await verify({ token: idToken({}), audience: "client-id", nonce: "nonce" })).toBeNull();
  });

  test("rejects a token signed with another key", async () => {
    const token = idToken({}).split(".");
    const forged = `${token[0]}.${token[1]}.${sign(
      "RSA-SHA256",
      Buffer.from(`${token[0]}.${token[1]}`),
      generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey,
    ).toString("base64url")}`;
    expect(await verify({ token: forged, audience: "client-id" })).toBeNull();
  });
});

test("gives up on a Google certs endpoint that never answers", async () => {
  const verify = createGoogleIdTokenVerifier({
    certsUrl: new URL(`http://127.0.0.1:${hangingServer.port.toString()}/certs`),
    timeoutMs: 100,
  });
  const start = performance.now();

  expect(await verify({ token: idToken({}), audience: "client-id" })).toBeNull();
  expect(performance.now() - start).toBeLessThan(2_000);
});
