import { beforeEach, expect, mock, test } from "bun:test";
import { apiCompatibilityLevel } from "@openbeacon/shared";

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
  baseUrl: "https://api.example.test",
  getBaseUrl: () => "https://api.example.test",
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

const { feedbackClient, trpcClient } = await import("./api.ts");
const { authClient } = await import("./auth-client.ts");
const { getApiCompatibility } = await import("./apiCompatibility.ts");

const tooOld = () =>
  new Response(
    JSON.stringify({
      code: "CLIENT_TOO_OLD",
      minClientApiCompatibilityLevel: apiCompatibilityLevel + 1,
    }),
    { status: 426, headers: { "content-type": "application/json" } },
  );

beforeEach(() => {
  requests.length = 0;
  stored.clear();
});

test("feedback requests carry the level but never change the app's state", async () => {
  respond = tooOld;
  await expect(feedbackClient.account.version.query()).rejects.toThrow();
  expect(requests[0]?.url).toStartWith("https://hosted.example.test/api/trpc/");
  expect(requests[0]?.headers.get("x-openbeacon-api-compatibility-level")).toBe(
    String(apiCompatibilityLevel),
  );
  expect(getApiCompatibility()).toBeNull();
});

test("tRPC requests carry the level and a 426 blocks the app", async () => {
  respond = tooOld;
  await expect(trpcClient.account.version.query()).rejects.toThrow();
  expect(requests[0]?.url).toStartWith("https://api.example.test/api/trpc/account.version");
  expect(requests[0]?.headers.get("x-openbeacon-api-compatibility-level")).toBe(
    String(apiCompatibilityLevel),
  );
  expect(requests[0]?.headers.get("x-trpc-source")).toBe("expo-react");
  expect(getApiCompatibility()?.problem).toBe("appTooOld");
});

test("auth requests carry the level", async () => {
  respond = () =>
    new Response("null", { status: 200, headers: { "content-type": "application/json" } });
  await authClient.getSession();
  const authRequest = requests.find(({ url }) => url.includes("/api/auth/get-session"));
  expect(authRequest?.headers.get("x-openbeacon-api-compatibility-level")).toBe(
    String(apiCompatibilityLevel),
  );
});
