import { describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { apiCompatibilityLevel, apiCompatibilityLevelHeader } from "@openbeacon/shared";
import { Hono } from "hono";
import type { AppEnv } from "../types/AppEnv.ts";

const requestBatch = async (size: number) => {
  const { prisma } = await import("@openbeacon/database");
  const { default: trpc } = await import("./trpc.ts");
  const app = new Hono<AppEnv>().basePath("/api").route("/", trpc);
  const procedures = Array.from({ length: size }, () => "auth.providers").join(",");
  return app.request(
    `/api/trpc/${procedures}?batch=1`,
    { headers: { [apiCompatibilityLevelHeader]: String(apiCompatibilityLevel) } },
    { cache: createIntegrationTestCache(() => 0), clientIp: "127.0.0.1", db: prisma },
  );
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("adversarial tRPC batching", () => {
  test("probe ADV-IN-7: one anonymous request runs 200 batched procedure calls", async () => {
    const response = await requestBatch(200);
    expect(response.status).toBe(200);
    expect(((await response.json()) as unknown[]).length).toBe(200);
  });

  test.skip("ADV-IN-7 (open bug): a tRPC batch has no size limit — a 200-call batch should be refused", async () => {
    const response = await requestBatch(200);
    expect(response.status).not.toBe(200);
  });
});
