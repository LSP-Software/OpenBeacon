import { afterAll, expect, mock, test } from "bun:test";

const query = mock(async () => []);
const s3 = mock(async () => {});
const mapStorage = mock(async () => {});
const email = mock(async () => {});
let checks: Record<string, () => Promise<unknown>> = {};

mock.module("./db.ts", () => ({ db: { $queryRaw: query } }));
mock.module("./env.ts", () => ({ env: { REDIS_URL: "redis://localhost:6379" } }));
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
  expect(checks["Redis"]).toBeFunction();
  expect(s3).toHaveBeenCalledTimes(1);
  expect(mapStorage).toHaveBeenCalledTimes(1);
  expect(email).toHaveBeenCalledTimes(1);
});
