import { afterAll, expect, mock, spyOn, test } from "bun:test";

const query = mock(async () => []);
const s3 = mock(async () => {});
const mapStorage = mock(async () => {});
const email = mock(async () => {});
const getAccessToken = mock(async () => "access-token");
const ping = mock(async (_redisUrl: string) => {});
const findMissingPermissions = mock(async () => ({
  missing: [] as string[],
  keyPattern: "openbeacon:*",
}));
let checks: Record<string, () => Promise<unknown>> = {};
let optionalChecks: Record<
  string,
  { check: () => Promise<unknown>; isUnreachable: (error: Error) => boolean }
> = {};

mock.module("./db.ts", () => ({ db: { $queryRaw: query } }));
mock.module("./cache.ts", () => ({ cache: { findMissingPermissions } }));
mock.module("./env.ts", () => ({ env: { REDIS_URL: "redis://openbeacon:secret@redis:6379" } }));
mock.module("@openbeacon/cache", () => ({ pingRedis: ping }));
mock.module("@openbeacon/api/checkStorage.ts", () => ({ checkImageStorage: s3 }));
mock.module("@openbeacon/api/mapStorage.ts", () => ({ checkMapStorage: mapStorage }));
mock.module("@openbeacon/email", () => ({
  checkEmail: email,
  emailEnabled: true,
  emailUnreachableCode: "EMAIL_UNREACHABLE",
}));
const checkGoogleSignIn = mock(async () => ({
  status: "rejected",
  detail: "invalid_client: The OAuth client was not found.",
}));
const startupErrors = spyOn(console, "error").mockImplementation(() => {});
mock.module("@openbeacon/auth", () => ({ checkGoogleSignIn, fcm: { getAccessToken } }));
const shared = await import("@openbeacon/shared");
mock.module("@openbeacon/shared", () => ({
  ...shared,
  checkServices: async (services: typeof checks) => {
    checks = services;
  },
}));
mock.module("./checkOptionalServices.ts", () => ({
  checkOptionalServices: async (services: typeof optionalChecks) => {
    optionalChecks = services;
  },
}));

await import("./validateServices.ts");
const startupErrorCalls = [...startupErrors.mock.calls];
startupErrors.mockRestore();
afterAll(() => mock.restore());

test("a Google OAuth client that Google rejects is reported without stopping startup", () => {
  expect(checkGoogleSignIn).toHaveBeenCalledTimes(1);
  expect(startupErrorCalls).toEqual([
    [
      `  Google sign-in: Google rejected GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (invalid_client: The OAuth client was not found.). Set them to the client ID and secret of the same "Web application" OAuth client, the one the app was built with. Starting anyway, but Google sign-in and deleting Google accounts won't work until this is fixed.`,
    ],
  ]);
});

test("wires each configured service into startup validation", async () => {
  expect(Object.keys(checks)).toEqual(["PostgreSQL", "Redis", "Image storage", "Map storage"]);
  expect(Object.keys(optionalChecks)).toEqual(["Email", "Push (FCM)"]);
  await Promise.all([
    checks["PostgreSQL"]?.(),
    checks["Image storage"]?.(),
    checks["Map storage"]?.(),
    optionalChecks["Email"]?.check(),
    optionalChecks["Push (FCM)"]?.check(),
  ]);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0]?.[0]).toEqual(["SELECT 1"]);
  expect(s3).toHaveBeenCalledTimes(1);
  expect(mapStorage).toHaveBeenCalledTimes(1);
  expect(email).toHaveBeenCalledTimes(1);
  expect(getAccessToken).toHaveBeenCalledTimes(1);
});

test("an email provider or Google outage is told apart from a configuration error", () => {
  const failure = (code: string) => Object.assign(new Error("failed"), { code });
  const emailUnreachable = optionalChecks["Email"]?.isUnreachable;
  const pushUnreachable = optionalChecks["Push (FCM)"]?.isUnreachable;
  expect(emailUnreachable?.(failure("EMAIL_UNREACHABLE"))).toBe(true);
  expect(emailUnreachable?.(new Error("Resend rejected the API key: invalid_api_key"))).toBe(false);
  for (const code of ["FCM_AUTH_UNREACHABLE", "FCM_AUTH_503", "FCM_AUTH_429"])
    expect(pushUnreachable?.(failure(code))).toBe(true);
  for (const code of ["FCM_AUTH_400", "FCM_AUTH_401", "FCM_AUTH_403", "ERR_JOSE_GENERIC"])
    expect(pushUnreachable?.(failure(code))).toBe(false);
});

test("the Redis check fails and says how to grant the commands the Redis user can't run", async () => {
  const errors = spyOn(console, "error").mockImplementation(() => {});
  await expect(checks["Redis"]?.()).resolves.toBeUndefined();
  expect(ping).toHaveBeenCalledWith("redis://openbeacon:secret@redis:6379");
  findMissingPermissions.mockResolvedValueOnce({
    missing: ["HSETNX", "ZADD"],
    keyPattern: "openbeacon:*",
  });
  await expect(checks["Redis"]?.()).rejects.toMatchObject({ code: "NOPERM" });
  expect(errors).toHaveBeenCalledWith(
    "  Redis: the Redis user can't run HSETNX, ZADD on keys matching openbeacon:*. Grant them with: ACL SETUSER openbeacon ~openbeacon:* +hsetnx +zadd",
  );
  errors.mockRestore();
});

test("a Redis connection failure is reported before checking permissions", async () => {
  findMissingPermissions.mockClear();
  ping.mockRejectedValueOnce(
    Object.assign(new Error("WRONGPASS"), { code: "ERR_REDIS_AUTHENTICATION_FAILED" }),
  );
  await expect(checks["Redis"]?.()).rejects.toMatchObject({
    code: "ERR_REDIS_AUTHENTICATION_FAILED",
  });
  expect(findMissingPermissions).not.toHaveBeenCalled();
});
