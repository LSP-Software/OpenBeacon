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
  test("uses the backend release version in responses and stored feedback", async () => {
    const { auth } = await import("@openbeacon/auth");
    const { prisma } = await import("@openbeacon/database");
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
      await prisma.user.create({
        data: { id: prefix, name: "Feedback test", email: `${prefix}@example.test` },
      });
      const version = await app.request("/api/trpc/account.version", {}, bindings);
      expect(version.status).toBe(200);
      expect(await version.json()).toMatchObject({ result: { data: { json: serverVersion } } });
      const response = await app.request(
        "/api/trpc/account.submitFeedback",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            json: {
              message: prefix,
              includeEmail: false,
              appVersion: "1.0.0",
              maplibreVersion: "10.4.2",
            },
          }),
        },
        bindings,
      );
      expect(response.status).toBe(200);
      expect(await prisma.feedback.findFirst({ where: { message: prefix } })).toMatchObject({
        email: null,
        appVersion: "1.0.0",
        maplibreVersion: "10.4.2",
        serverVersion,
      });
    } finally {
      session.mockRestore();
      await prisma.feedback.deleteMany({ where: { message: prefix } });
      await prisma.user.deleteMany({ where: { id: prefix } });
      await prisma.$disconnect();
    }
  });
});
