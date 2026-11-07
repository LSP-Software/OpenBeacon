import { describe, expect, spyOn, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { Hono } from "hono";
import type { AppEnv } from "../types/AppEnv.ts";
import { serverVersion } from "../version.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("feedback HTTP endpoint", () => {
  test("a default self-hosted backend reports its version and rejects feedback", async () => {
    const { auth } = await import("@openbeacon/auth");
    const { prisma } = await import("@openbeacon/database");
    const { env } = await import("../env.ts");
    const { default: trpc } = await import("./trpc.ts");
    const prefix = `http-feedback-${crypto.randomUUID()}`;
    const app = new Hono<AppEnv>().basePath("/api").route("/", trpc);
    const bindings = {
      cache: new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 }),
      clientIp: "127.0.0.1",
      db: prisma,
    };
    const session = spyOn(auth.api, "getSession").mockResolvedValue({
      user: { id: prefix, email: `${prefix}@example.test` },
    } as never);
    try {
      expect(env.SELF_HOSTED).toBe(true);
      const version = await app.request("/api/trpc/account.version", {}, bindings);
      expect(version.status).toBe(200);
      expect(await version.json()).toMatchObject({ result: { data: { json: serverVersion } } });
      session.mockResolvedValue(null as never);
      const response = await app.request(
        "/api/trpc/feedback.submit",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: { message: prefix } }),
        },
        bindings,
      );
      expect(response.status).toBe(404);
      expect(await prisma.feedback.findFirst({ where: { message: prefix } })).toBeNull();
    } finally {
      session.mockRestore();
      await prisma.$disconnect();
    }
  });
});
