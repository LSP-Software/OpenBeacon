import { afterAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { createGoogleIdTokenVerifier, googleRefusalReason } from "./googleIdToken.ts";

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
    nonce: "nonce",
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
    expect(
      await verify({ token: idToken({}), audience: "client-id", nonce: "nonce" }),
    ).toMatchObject({ ok: true, payload: { sub: "google-subject" } });
    expect(
      await verify({
        token: idToken({ iss: "accounts.google.com" }),
        audience: "client-id",
        nonce: "nonce",
      }),
    ).toMatchObject({ ok: true, payload: { sub: "google-subject" } });
  });

  test("rejects a token for another client, naming the client it was issued for", async () => {
    expect(
      await verify({ token: idToken({ aud: "other" }), audience: "client-id", nonce: "nonce" }),
    ).toEqual({ ok: false, refused: "wrong-client", tokenClientId: "other" });
    expect(
      await verify({
        token: idToken({ aud: ["first", "second"] }),
        audience: "client-id",
        nonce: "nonce",
      }),
    ).toEqual({ ok: false, refused: "wrong-client", tokenClientId: "first, second" });
  });

  test("rejects a token from another issuer", async () => {
    expect(
      await verify({
        token: idToken({ iss: "https://evil.example" }),
        audience: "client-id",
        nonce: "nonce",
      }),
    ).toEqual({ ok: false, refused: "invalid" });
  });

  test("rejects an expired token or one issued over an hour ago", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(
      await verify({
        token: idToken({ iat: now - 600, exp: now - 300 }),
        audience: "client-id",
        nonce: "nonce",
      }),
    ).toEqual({ ok: false, refused: "expired" });
    expect(
      await verify({
        token: idToken({ iat: now - 3_700, exp: now + 300 }),
        audience: "client-id",
        nonce: "nonce",
      }),
    ).toEqual({ ok: false, refused: "expired" });
  });

  test("rejects a token without the expected nonce, saying when it carries another one", async () => {
    expect(
      await verify({ token: idToken({ nonce: "other" }), audience: "client-id", nonce: "nonce" }),
    ).toEqual({ ok: false, refused: "wrong-nonce" });
    expect(
      await verify({
        token: idToken({ aud: "other", nonce: "other" }),
        audience: "client-id",
        nonce: "nonce",
      }),
    ).toEqual({ ok: false, refused: "wrong-client", tokenClientId: "other" });
    expect(
      await verify({ token: idToken({ nonce: undefined }), audience: "client-id", nonce: "nonce" }),
    ).toEqual({ ok: false, refused: "invalid" });
    expect(
      await verify({ token: idToken({ nonce: "" }), audience: "client-id", nonce: "" }),
    ).toEqual({ ok: false, refused: "invalid" });
  });

  test("rejects a token signed with another key", async () => {
    const token = idToken({}).split(".");
    const forged = `${token[0]}.${token[1]}.${sign(
      "RSA-SHA256",
      Buffer.from(`${token[0]}.${token[1]}`),
      generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey,
    ).toString("base64url")}`;
    expect(await verify({ token: forged, audience: "client-id", nonce: "nonce" })).toEqual({
      ok: false,
      refused: "invalid",
    });
  });
});

test("gives up on a Google certs endpoint that never answers", async () => {
  const verify = createGoogleIdTokenVerifier({
    certsUrl: new URL(`http://127.0.0.1:${hangingServer.port.toString()}/certs`),
    timeoutMs: 100,
  });
  const start = performance.now();

  expect(await verify({ token: idToken({}), audience: "client-id", nonce: "nonce" })).toEqual({
    ok: false,
    refused: "keys-unreachable",
  });
  expect(performance.now() - start).toBeLessThan(2_000);
});

test("a token for another client says which client ID to set", () => {
  expect(
    googleRefusalReason({
      result: {
        ok: false,
        refused: "wrong-client",
        tokenClientId: "985-app.apps.googleusercontent.com",
      },
      clientId: "1077-server.apps.googleusercontent.com",
      serverUrl: "https://api.example.com",
    }),
  ).toBe(
    "because Google issued the token for client 985-app.apps.googleusercontent.com, but GOOGLE_CLIENT_ID is 1077-server.apps.googleusercontent.com. Set GOOGLE_CLIENT_ID to the web client ID the app was built with (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID), and GOOGLE_CLIENT_SECRET to that client's secret.",
  );
});
