import { afterAll, expect, mock, test } from "bun:test";

const query = mock(async () => []);
const s3 = mock(async () => {});
const r2 = mock(async () => {});
let checks: Record<string, () => Promise<unknown>> = {};

mock.module("./db.ts", () => ({ db: { $queryRaw: query } }));
mock.module("./env.ts", () => ({ env: { REDIS_URL: "redis://localhost:6379" } }));
mock.module("@openbeacon/api/checkStorage.ts", () => ({ checkS3: s3, checkR2: r2 }));
mock.module("./checkServices.ts", () => ({
  checkServices: async (services: typeof checks) => {
    checks = services;
  },
}));

await import("./validateServices.ts");
afterAll(() => mock.restore());

test("wires each configured service into startup validation", async () => {
  expect(Object.keys(checks)).toEqual(["PostgreSQL", "Redis", "S3", "R2"]);
  await Promise.all([checks["PostgreSQL"]?.(), checks["S3"]?.(), checks["R2"]?.()]);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0]?.[0]).toEqual(["SELECT 1"]);
  expect(checks["Redis"]).toBeFunction();
  expect(s3).toHaveBeenCalledTimes(1);
  expect(r2).toHaveBeenCalledTimes(1);
});
