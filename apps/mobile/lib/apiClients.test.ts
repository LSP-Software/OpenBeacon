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

const { feedbackClient, queryClient, trpcClient } = await import("./api.ts");
const { authClient } = await import("./auth-client.ts");
const { clearApiCompatibility, getApiCompatibility } = await import("./apiCompatibility.ts");

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

test("queries retry only network failures and server errors, never refusals", async () => {
  const retry = queryClient.getDefaultOptions().queries?.retry;
  if (typeof retry !== "function") throw new Error("Missing retry rule");
  const failure = async (response: () => Response) => {
    clearApiCompatibility();
    respond = response;
    const result = await trpcClient.account.version.query().then(
      () => null,
      (error: unknown) => error,
    );
    if (!(result instanceof Error)) throw new Error("Expected the query to fail");
    return result;
  };
  const trpcError = (code: string, httpStatus: number) => () =>
    new Response(
      JSON.stringify([
        { error: { json: { message: code, code: -32000, data: { code, httpStatus } } } },
      ]),
      { status: httpStatus, headers: { "content-type": "application/json" } },
    );

  const tooOldError = await failure(tooOld);
  expect(retry(0, tooOldError)).toBe(false);
  clearApiCompatibility();
  expect(retry(0, tooOldError)).toBe(false);
  expect(retry(0, await failure(trpcError("CONFLICT", 409)))).toBe(false);
  expect(retry(0, await failure(trpcError("PRECONDITION_FAILED", 412)))).toBe(false);
  expect(retry(0, await failure(trpcError("INTERNAL_SERVER_ERROR", 500)))).toBe(true);
  const offline = await failure(() => {
    throw new TypeError("Network request failed");
  });
  expect(retry(0, offline)).toBe(true);
  expect(retry(3, offline)).toBe(false);
});

test("a request made for an account round that has ended is never sent", async () => {
  const { refuseStartedRounds, startAccountRound } = await import("./accountSession.ts");
  clearApiCompatibility();
  respond = () => new Response("{}");
  stored.set(
    "encryption.device.registered",
    JSON.stringify(["https://api.example.test", "user-b", "device-b", "key-b"]),
  );
  const otherAccount = startAccountRound("user-a");
  const rejected = startAccountRound("user-b");
  refuseStartedRounds();

  for (const accountRound of [otherAccount, rejected]) {
    await expect(
      trpcClient.account.version.query(undefined, { context: { accountRound } }),
    ).rejects.toThrow("Signed out of the account this request was for.");
  }
  expect(requests).toEqual([]);

  await trpcClient.account.version
    .query(undefined, { context: { accountRound: startAccountRound("user-b") } })
    .catch(() => {});
  expect(requests).toHaveLength(1);
});
