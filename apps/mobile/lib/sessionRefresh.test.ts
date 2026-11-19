import { afterAll, expect, mock, setSystemTime, test } from "bun:test";

const mmkv = new Map<string, string>();
const secureStore = new Map<string, string>();

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

const minute = 60_000;
const day = 24 * 60 * minute;
const expiresIn = 7 * day;
const updateAge = day;
const sessionCookie = "better-auth.session_token=token.signature; Max-Age=604800; Path=/";
let rowExpiresAt = 0;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  if (url.endsWith("/sign-in/email")) {
    rowExpiresAt = Date.now() + expiresIn;
    return json({ token: "token", user: { id: "user-1" } }, 200, { "set-cookie": sessionCookie });
  }
  const signedIn =
    (new Headers(init?.headers).get("cookie") ?? "").includes("token.signature") &&
    rowExpiresAt > Date.now();
  if (url.includes("/api/auth/get-session")) {
    if (!signedIn) return json(null, 200);
    const refresh = rowExpiresAt - expiresIn + updateAge <= Date.now();
    if (refresh) rowExpiresAt = Date.now() + expiresIn;
    return json(
      {
        session: { id: "session-1", token: "token", expiresAt: new Date(rowExpiresAt) },
        user: { id: "user-1" },
      },
      200,
      refresh ? { "set-cookie": sessionCookie } : {},
    );
  }
  if (!signedIn) {
    return json([{ error: { json: { message: "UNAUTHORIZED", code: -32001, data: {} } } }], 401);
  }
  return json([{ result: { data: { json: { version: "1.0.0" } } } }], 200);
}) as typeof fetch;

const { authClient } = await import("./auth-client.ts");
const { trpcClient } = await import("./api.ts");
const { refreshSessionIfDue } = await import("./sessionRefresh.ts");

afterAll(() => setSystemTime());

test("a phone that only uploads in the background stays signed in past the cookie's 7 days", async () => {
  const start = new Date("2026-11-18T09:00:00Z").getTime();
  setSystemTime(new Date(start));
  await authClient.signIn.email({ email: "alice@example.test", password: "password" });

  for (let elapsed = 10 * minute; elapsed <= 8 * day; elapsed += 10 * minute) {
    setSystemTime(new Date(start + elapsed));
    await refreshSessionIfDue();
    const upload = await trpcClient.account.version.query().then(
      () => null,
      () => (elapsed / day).toFixed(2),
    );
    expect(upload).toBeNull();
  }
  expect(await authClient.getCookie()).toContain("token.signature");
}, 60_000);
