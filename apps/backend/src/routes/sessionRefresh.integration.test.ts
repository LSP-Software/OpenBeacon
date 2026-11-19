import { describe, expect, setSystemTime, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { Hono } from "hono";
import type { AppEnv } from "../types/AppEnv.ts";

const day = 24 * 60 * 60_000;

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("session refresh", () => {
  test("tRPC never takes the daily refresh, so the phone's own session check gets the new cookie", async () => {
    const { prisma } = await import("@openbeacon/database");
    const { default: trpc } = await import("./trpc.ts");
    const { default: authRoute } = await import("./auth.ts");
    const email = `session-refresh-${crypto.randomUUID()}@example.test`;
    const app = new Hono<AppEnv>().basePath("/api").route("/", authRoute).route("/", trpc);
    const bindings = {
      cache: createIntegrationTestCache(() => 0),
      clientIp: "127.0.0.1",
      db: prisma,
    };
    const post = (path: string, body: unknown) =>
      app.request(
        path,
        {
          method: "POST",
          headers: { "content-type": "application/json", "expo-origin": "openbeacon://" },
          body: JSON.stringify(body),
        },
        bindings,
      );
    const trpcCall = (cookie: string) =>
      app.request("/api/trpc/auth.deviceKeyContext", { headers: { cookie } }, bindings);
    const getSession = (cookie: string) =>
      app.request("/api/auth/get-session", { headers: { cookie } }, bindings);
    const start = Date.now();
    try {
      await post("/api/auth/sign-up/email", {
        email,
        password: "testing-password-123",
        name: "Alice",
      });
      const signIn = await post("/api/auth/sign-in/email", {
        email,
        password: "testing-password-123",
      });
      const setCookie = signIn.headers.getSetCookie().join();
      expect(setCookie).toContain("Max-Age=604800");
      const cookie =
        signIn.headers
          .getSetCookie()
          .find((value) => value.includes("session_token"))
          ?.split(";")[0] ?? "";
      const token = decodeURIComponent(cookie.split("=")[1] ?? "").split(".")[0] ?? "";
      const expiresAt = async () =>
        (await prisma.session.findUniqueOrThrow({ where: { token } })).expiresAt.getTime();
      const signedInAt = await expiresAt();

      setSystemTime(new Date(start + 2 * day));
      const viaTrpc = await trpcCall(cookie);
      expect(viaTrpc.status).toBe(200);
      expect(viaTrpc.headers.getSetCookie()).toEqual([]);
      expect(await expiresAt()).toBe(signedInAt);

      const viaSessionCheck = await getSession(cookie);
      expect(viaSessionCheck.headers.getSetCookie().join()).toContain("Max-Age=604800");
      expect(await expiresAt()).toBeGreaterThanOrEqual(start + 9 * day - 60_000);

      for (let elapsed = 3 * day; elapsed <= 10 * day; elapsed += day) {
        setSystemTime(new Date(start + elapsed));
        expect((await getSession(cookie)).headers.getSetCookie().join()).toContain(
          "Max-Age=604800",
        );
        expect((await trpcCall(cookie)).status).toBe(200);
      }

      setSystemTime(new Date(start + 18 * day));
      expect((await trpcCall(cookie)).status).toBe(401);
    } finally {
      setSystemTime();
      await prisma.user.deleteMany({ where: { email } });
      await prisma.$disconnect();
    }
  });
});
