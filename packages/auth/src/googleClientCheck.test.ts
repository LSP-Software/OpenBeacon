import { afterAll, expect, test } from "bun:test";
import { createGoogleClientCheck } from "./googleClientCheck.ts";

let reply = () =>
  Response.json(
    { error: "invalid_grant", error_description: "Malformed auth code." },
    { status: 400 },
  );
let lastRequest = new URLSearchParams();
const tokenServer = Bun.serve({
  port: 0,
  fetch: async (request) => {
    lastRequest = new URLSearchParams(await request.text());
    return reply();
  },
});
const hangingServer = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => {} } });

afterAll(() => {
  tokenServer.stop(true);
  hangingServer.stop(true);
});

const credentials = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://api.example.com/api/auth/google-deletion-callback",
};
const check = createGoogleClientCheck({
  tokenUrl: new URL(`http://127.0.0.1:${tokenServer.port.toString()}/token`),
  timeoutMs: 1_000,
});

test("a client Google knows, with the right secret, only has its made-up code refused", async () => {
  expect(await check(credentials)).toEqual({
    status: "valid",
    detail: "invalid_grant: Malformed auth code.",
  });
  expect(Object.fromEntries(lastRequest)).toEqual({
    code: "openbeacon-startup-check",
    client_id: "client-id",
    client_secret: "client-secret",
    redirect_uri: "https://api.example.com/api/auth/google-deletion-callback",
    grant_type: "authorization_code",
  });
});

test.each([
  ["an unknown client", "invalid_client", "The OAuth client was not found."],
  ["a wrong secret", "invalid_client", "Unauthorized"],
  ["a client that can't use this flow", "unauthorized_client", "Unauthorized"],
])("reports %s as rejected", async (_name, error, description) => {
  reply = () => Response.json({ error, error_description: description }, { status: 401 });
  expect(await check(credentials)).toEqual({
    status: "rejected",
    detail: `${error}: ${description}`,
  });
});

test("treats a Google outage or rate limit as unreachable", async () => {
  reply = () => new Response("unavailable", { status: 503 });
  expect(await check(credentials)).toEqual({ status: "unreachable", detail: "HTTP 503" });
  reply = () => Response.json({ error: "rate_limit_exceeded" }, { status: 429 });
  expect(await check(credentials)).toEqual({
    status: "unreachable",
    detail: "rate_limit_exceeded",
  });
});

test("reports an answer it doesn't recognise as unexpected", async () => {
  reply = () => Response.json({ error: "invalid_request" }, { status: 400 });
  expect(await check(credentials)).toEqual({ status: "unexpected", detail: "invalid_request" });
});

test("gives up on a token endpoint that never answers", async () => {
  const hanging = createGoogleClientCheck({
    tokenUrl: new URL(`http://127.0.0.1:${hangingServer.port.toString()}/token`),
    timeoutMs: 100,
  });
  expect(await hanging(credentials)).toEqual({ status: "unreachable", detail: "TimeoutError" });
});
