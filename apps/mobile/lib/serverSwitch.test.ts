import { beforeEach, expect, mock, test } from "bun:test";

const mmkv = new Map<string, string>();
const secureStore = new Map<string, string>();
const requests: { url: string; body: string | null }[] = [];

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => mmkv.get(key),
    set: (key: string, value: string) => void mmkv.set(key, value),
    remove: (key: string) => void mmkv.delete(key),
    contains: (key: string) => mmkv.has(key),
  },
}));
mock.module("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  getItem: (key: string) => secureStore.get(key) ?? null,
  setItem: (key: string, value: string) => void secureStore.set(key, value),
  getItemAsync: async (key: string) => secureStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void secureStore.set(key, value),
  deleteItemAsync: async (key: string) => void secureStore.delete(key),
}));
mock.module("expo-constants", () => ({ default: { expoConfig: { scheme: "openbeacon" } } }));
mock.module("expo-linking", () => ({ createURL: (path: string) => `openbeacon://${path}` }));
mock.module("./endSession.ts", () => ({ endSession: async () => ({ signedOut: true }) }));

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  requests.push({ url, body: typeof init?.body === "string" ? init.body : null });
  if (url.endsWith("/sign-in/email")) {
    return new Response(JSON.stringify({ token: "token", user: { id: "user-1" } }), {
      headers: {
        "content-type": "application/json",
        "set-cookie": `better-auth.session_token=${new URL(url).host}; Max-Age=604800; Path=/`,
      },
    });
  }
  return new Response("null", { headers: { "content-type": "application/json" } });
}) as typeof fetch;

const { authClient } = await import("./auth-client.ts");
const { trpcClient } = await import("./api.ts");
const { changeServer } = await import("./changeServer.ts");
const { checkServerCompatibility } = await import("./apiCompatibility.ts");

const hosts = () => requests.map(({ url }) => new URL(url).host);

beforeEach(() => {
  requests.length = 0;
});

test("after changing server, sign-in, sign-up and tRPC go to the new server only", async () => {
  await authClient.signIn.email({ email: "sam@example.test", password: "hosted-password" });
  expect(hosts()).toEqual(["api.openbeacon.net"]);
  expect(await authClient.getCookie()).toContain("api.openbeacon.net");

  await changeServer("https://beacon.my-family.example");
  requests.length = 0;
  await authClient.signIn.email({ email: "sam@example.test", password: "self-hosted-password" });
  await authClient.signUp.email({
    email: "sam@example.test",
    password: "self-hosted-password",
    name: "Sam",
  });
  await trpcClient.account.version.query().catch(() => {});

  expect(hosts()).toEqual([
    "beacon.my-family.example",
    "beacon.my-family.example",
    "beacon.my-family.example",
  ]);
  expect(requests.filter(({ body }) => body?.includes("password"))).toHaveLength(2);
  expect(await authClient.getCookie()).toContain("beacon.my-family.example");
  expect(await authClient.getCookie()).not.toContain("api.openbeacon.net");

  await changeServer("");
  requests.length = 0;
  expect(await authClient.getCookie()).toContain("api.openbeacon.net");
  await authClient.getSession();
  expect(hosts()).toEqual(["api.openbeacon.net"]);
});

test("the compatibility probe and tRPC never use the phone's own cookie jar", async () => {
  const credentials: (RequestCredentials | undefined)[] = [];
  const recordingFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    credentials.push(init?.credentials);
    return recordingFetch(input, init);
  }) as typeof fetch;
  await checkServerCompatibility("https://beacon.my-family.example");
  await trpcClient.account.version.query().catch(() => {});
  await authClient.getSession();
  globalThis.fetch = recordingFetch;
  expect(credentials.length).toBeGreaterThanOrEqual(3);
  expect(credentials.map(String)).toEqual(credentials.map(() => "omit"));
});
