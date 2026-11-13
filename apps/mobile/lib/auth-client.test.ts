import { beforeEach, expect, mock, test } from "bun:test";

const secureStore = new Map<string, string>();
const secureStoreOptions: unknown[] = [];
let server = "https://hosted.example.test";

mock.module("./storage.ts", () => ({
  storage: { getString: () => undefined, set: () => {}, remove: () => {}, contains: () => false },
}));
mock.module("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  getItem: (key: string, options: unknown) => {
    secureStoreOptions.push(options);
    return secureStore.get(key) ?? null;
  },
  setItem: (key: string, value: string, options: unknown) => {
    secureStoreOptions.push(options);
    secureStore.set(key, value);
  },
  getItemAsync: async (key: string, options: unknown) => {
    secureStoreOptions.push(options);
    return secureStore.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string, options: unknown) => {
    secureStoreOptions.push(options);
    secureStore.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secureStore.delete(key);
  },
}));
mock.module("expo-constants", () => ({ default: { expoConfig: { scheme: "openbeacon" } } }));
mock.module("expo-linking", () => ({ createURL: (path: string) => `openbeacon://${path}` }));

const loadAuthClient = async (baseUrl: string) => {
  server = baseUrl;
  mock.module("./currentServer.ts", () => ({ baseUrl: server }));
  return import(`./auth-client.ts?server=${encodeURIComponent(baseUrl)}`) as Promise<
    typeof import("./auth-client.ts")
  >;
};

beforeEach(() => {
  secureStore.clear();
  secureStoreOptions.length = 0;
});

test("each server's session cookie is stored under its own key", async () => {
  const hosted = await loadAuthClient("https://hosted.example.test");
  const selfHosted = await loadAuthClient("https://self-hosted.example.test");
  expect(hosted.getServerKey("https://hosted.example.test")).not.toBe(
    selfHosted.getServerKey("https://self-hosted.example.test"),
  );
  secureStore.set(
    `openbeacon_${hosted.getServerKey("https://hosted.example.test")}_cookie`,
    JSON.stringify({ "better-auth.session_token": { value: "hosted-session", expires: null } }),
  );

  expect(await hosted.authClient.getCookie()).toContain("hosted-session");
  expect(await selfHosted.authClient.getCookie()).toBe("");
});

test("credentials are stored only for this device while unlocked", async () => {
  const { authClient } = await loadAuthClient("https://hosted.example.test");
  await authClient.getCookie();
  expect(secureStoreOptions.length).toBeGreaterThan(0);
  expect(secureStoreOptions).toEqual(
    secureStoreOptions.map(() => ({ keychainAccessible: "when-unlocked-this-device-only" })),
  );
});

test("a session token saved for one server is never read for another, and is dropped", async () => {
  const hosted = await loadAuthClient("https://hosted.example.test");
  await hosted.saveSessionTokenToRevoke("hosted-token");
  expect(await hosted.readSessionTokenToRevoke()).toBe("hosted-token");

  const selfHosted = await loadAuthClient("https://self-hosted.example.test");
  expect(await selfHosted.readSessionTokenToRevoke()).toBeNull();
  expect(secureStore.has("sessionTokenToRevokeOnNextLogin")).toBe(false);
});

test("a session token saved before tokens were tied to a server is dropped", async () => {
  secureStore.set("sessionTokenToRevokeOnNextLogin", "bare-token");
  const { readSessionTokenToRevoke } = await loadAuthClient("https://hosted.example.test");
  expect(await readSessionTokenToRevoke()).toBeNull();
  expect(secureStore.has("sessionTokenToRevokeOnNextLogin")).toBe(false);
});
