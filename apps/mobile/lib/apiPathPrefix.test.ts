import { beforeEach, expect, mock, test } from "bun:test";

const stored = new Map<string, string>();

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => stored.get(key),
    set: (key: string, value: string) => stored.set(key, value),
    remove: (key: string) => stored.delete(key),
    contains: (key: string) => stored.has(key),
  },
}));
mock.module("./currentServer.ts", () => ({
  baseUrl: "https://example.test/openbeacon",
  getBaseUrl: () => "https://example.test/openbeacon",
  getFeedbackUrl: () => "https://hosted.example.test",
}));
mock.module("expo-secure-store", () => ({
  getItem: () => null,
  setItem: () => {},
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
mock.module("expo-constants", () => ({ default: { expoConfig: { scheme: "openbeacon" } } }));
mock.module("expo-linking", () => ({ createURL: (path: string) => `openbeacon://${path}` }));

const requests: { url: string; headers: Headers }[] = [];
let respond: () => Response = () => new Response("{}");

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = input instanceof Request ? input : null;
  requests.push({
    url: request ? request.url : String(input),
    headers: new Headers(init?.headers ?? request?.headers),
  });
  return respond();
}) as typeof fetch;
const { trpcClient } = await import("./api.ts");
const { authClient } = await import("./auth-client.ts");
const { refreshApiCompatibility } = await import("./apiCompatibility.ts");

beforeEach(() => {
  requests.length = 0;
  respond = () =>
    new Response("null", { status: 200, headers: { "content-type": "application/json" } });
});

test("a server under a path gets tRPC, auth and health requests under that path", async () => {
  await trpcClient.account.version.query().catch(() => null);
  await authClient.getSession();
  await refreshApiCompatibility({ userRequested: true });

  expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
    "/openbeacon/api/trpc/account.version",
    "/openbeacon/api/auth/get-session",
    "/openbeacon/health",
  ]);
});
