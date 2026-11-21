import { afterAll, expect, test } from "bun:test";
import { apiCompatibilityLevel, apiCompatibilityLevelHeader } from "@openbeacon/shared";
import { checkServerGoogleClientId } from "./googleClientIdBuildCheck.ts";

let reply: () => Response = () => providers({ google: true, googleClientId: "web-client-id" });
let lastRequest = { url: "", level: null as string | null };
const server = Bun.serve({
  port: 0,
  fetch: (request) => {
    lastRequest = { url: request.url, level: request.headers.get(apiCompatibilityLevelHeader) };
    return reply();
  },
});
const hangingServer = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => {} } });

afterAll(() => {
  server.stop(true);
  hangingServer.stop(true);
});

const providers = (json: Record<string, unknown>) =>
  Response.json({ result: { data: { json: { email: true, push: true, ...json } } } });
const origin = server.url.origin;
const serverUrl = `${origin}/openbeacon/`;
const check = () => checkServerGoogleClientId({ serverUrl, webClientId: "web-client-id" });

test("passes when the server uses the build's web client ID", async () => {
  expect(await check()).toEqual({ problem: null });
  expect(lastRequest.url).toBe(`${origin}/openbeacon/api/trpc/auth.providers`);
  expect(lastRequest.level).toBe(apiCompatibilityLevel.toString());
});

test("fails naming both client IDs when the server uses another one", async () => {
  reply = () => providers({ google: true, googleClientId: "server-client-id" });
  expect(await check()).toEqual({
    problem: "fail",
    message: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is web-client-id, but ${serverUrl} uses GOOGLE_CLIENT_ID server-client-id, so this build would hide Google sign-in. Use the same web client ID in both places. Pass --skip-server-check to build anyway.`,
  });
});

test("fails when the server has Google sign-in turned off", async () => {
  reply = () => providers({ google: false, googleClientId: null });
  expect(await check()).toMatchObject({ problem: "fail" });
});

test("only warns about a server too old to say its client ID", async () => {
  reply = () => providers({ google: true });
  expect(await check()).toMatchObject({ problem: "warn" });
});

test.each([
  ["an error status", () => new Response("down", { status: 502 })],
  ["something that isn't an OpenBeacon server", () => Response.json({ hello: "world" })],
  ["a body that isn't JSON", () => new Response("<html>")],
])("fails on %s and says how to skip the check", async (_name, answer) => {
  reply = answer;
  const result = await check();
  expect(result.problem).toBe("fail");
  expect(result.problem === "fail" && result.message).toEndWith(
    "Pass --skip-server-check to build anyway.",
  );
});

test("gives up on a server that never answers", async () => {
  const result = await checkServerGoogleClientId({
    serverUrl: `http://127.0.0.1:${hangingServer.port.toString()}`,
    webClientId: "web-client-id",
    timeoutMs: 100,
  });
  expect(result.problem).toBe("fail");
  expect(result.problem === "fail" && result.message).toContain("(TimeoutError)");
});
