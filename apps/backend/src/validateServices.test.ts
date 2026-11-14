import { afterAll, expect, mock, spyOn, test } from "bun:test";

const query = mock(async () => []);
const s3 = mock(async () => {});
const mapStorage = mock(async () => {});
const email = mock(async () => {});
const ping = mock(async (_redisUrl: string) => {});
const findMissingPermissions = mock(async () => ({
  missing: [] as string[],
  keyPattern: "openbeacon:*",
}));
let checks: Record<string, () => Promise<unknown>> = {};

mock.module("./db.ts", () => ({ db: { $queryRaw: query } }));
mock.module("./cache.ts", () => ({ cache: { findMissingPermissions } }));
mock.module("./env.ts", () => ({ env: { REDIS_URL: "redis://openbeacon:secret@redis:6379" } }));
mock.module("@openbeacon/cache", () => ({ pingRedis: ping }));
mock.module("@openbeacon/api/checkStorage.ts", () => ({
  checkImageStorage: s3,
  checkMapStorage: mapStorage,
}));
mock.module("@openbeacon/email", () => ({ checkEmail: email, emailEnabled: true }));
mock.module("./checkServices.ts", () => ({
  checkServices: async (services: typeof checks) => {
    checks = services;
  },
}));

await import("./validateServices.ts");
afterAll(() => mock.restore());

test("wires each configured service into startup validation", async () => {
  expect(Object.keys(checks)).toEqual([
    "PostgreSQL",
    "Redis",
    "Image storage",
    "Map storage",
    "Email",
  ]);
  await Promise.all([
    checks["PostgreSQL"]?.(),
    checks["Image storage"]?.(),
    checks["Map storage"]?.(),
    checks["Email"]?.(),
  ]);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0]?.[0]).toEqual(["SELECT 1"]);
  expect(s3).toHaveBeenCalledTimes(1);
  expect(mapStorage).toHaveBeenCalledTimes(1);
  expect(email).toHaveBeenCalledTimes(1);
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
