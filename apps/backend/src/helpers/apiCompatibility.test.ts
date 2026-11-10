import { describe, expect, test } from "bun:test";
import {
  apiCompatibilityLevel,
  apiCompatibilityLevelHeader,
  minClientApiCompatibilityLevel,
  minClientApiCompatibilityLevelHeader,
} from "@openbeacon/shared";
import { Hono } from "hono";
import {
  apiCompatibility,
  findUnknownProcedure,
  unknownProcedureBody,
} from "./apiCompatibility.ts";

const app = new Hono();
app.use("/api/*", apiCompatibility);
app.get("/api/thing", (c) => c.json({ ok: true }));
app.get("/api/raw", () => new Response("raw"));
app.get("/api/redirect", () => Response.redirect("https://example.com/", 302));
app.get("/api/auth/google-deletion-callback", (c) => c.redirect("openbeacon://google-deletion"));
app.get("/health", (c) => c.json({ status: "ok" }));

const request = (path: string, level?: string) =>
  app.request(
    path,
    level === undefined ? {} : { headers: { [apiCompatibilityLevelHeader]: level } },
  );

describe("apiCompatibility middleware", () => {
  test("serves a client at the minimum level and reports the server's levels", async () => {
    const response = await request("/api/thing", String(minClientApiCompatibilityLevel));
    expect(response.status).toBe(200);
    expect(response.headers.get(apiCompatibilityLevelHeader)).toBe(String(apiCompatibilityLevel));
    expect(response.headers.get(minClientApiCompatibilityLevelHeader)).toBe(
      String(minClientApiCompatibilityLevel),
    );
  });

  test("adds the level headers to responses a handler builds itself", async () => {
    const response = await request("/api/raw", String(apiCompatibilityLevel));
    expect(await response.text()).toBe("raw");
    expect(response.headers.get(apiCompatibilityLevelHeader)).toBe(String(apiCompatibilityLevel));
  });

  test("adds the level headers to a response whose headers are immutable", async () => {
    const response = await request("/api/redirect", String(apiCompatibilityLevel));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/");
    expect(response.headers.get(apiCompatibilityLevelHeader)).toBe(String(apiCompatibilityLevel));
    expect(response.headers.get(minClientApiCompatibilityLevelHeader)).toBe(
      String(minClientApiCompatibilityLevel),
    );
  });

  test("lets a browser open the Google deletion callback without a level", async () => {
    const response = await request("/api/auth/google-deletion-callback");
    expect(response.status).toBe(302);
    expect(response.headers.get(apiCompatibilityLevelHeader)).toBe(String(apiCompatibilityLevel));
  });

  test("still checks the level on other methods to the Google deletion callback", async () => {
    const response = await app.request("/api/auth/google-deletion-callback", { method: "POST" });
    expect(response.status).toBe(426);
  });

  test.each([
    ["a missing header", undefined],
    ["a level below the minimum", String(minClientApiCompatibilityLevel - 1)],
    ["a garbage header", "one"],
    ["a negative level", "-5"],
    ["a decimal level", "1.5"],
  ])("rejects %s with the frozen 426 body", async (_, level) => {
    const response = await request("/api/thing", level);
    expect(response.status).toBe(426);
    expect(await response.json()).toEqual({
      code: "CLIENT_TOO_OLD",
      minClientApiCompatibilityLevel,
    });
    expect(response.headers.get(apiCompatibilityLevelHeader)).toBe(String(apiCompatibilityLevel));
  });

  test("leaves /health open to clients that send no level", async () => {
    const response = await request("/health");
    expect(response.status).toBe(200);
  });
});

describe("findUnknownProcedure", () => {
  const procedures = { "account.version": {}, "groups.list": {} };
  const find = (path: string) =>
    findUnknownProcedure({ url: `http://localhost${path}`, endpoint: "/api/trpc", procedures });

  test("finds nothing when every procedure exists", () => {
    expect(find("/api/trpc/account.version")).toBeUndefined();
    expect(find("/api/trpc/account.version,groups.list?batch=1")).toBeUndefined();
  });

  test("finds an unknown procedure inside a batch", () => {
    expect(find("/api/trpc/account.version,places.list?batch=1")).toBe("places.list");
  });

  test("treats a comma as part of the name when the call isn't a batch", () => {
    expect(find("/api/trpc/account.version,groups.list")).toBe("account.version,groups.list");
  });

  test("decodes the path the same way tRPC does", () => {
    expect(find("/api/trpc/account.version%2Cgroups.list?batch=1")).toBeUndefined();
  });

  test("trims one leading and trailing slash like tRPC", () => {
    expect(find("/api/trpc/account.version/")).toBeUndefined();
    expect(find("/api/trpc//account.version")).toBe("/account.version");
  });

  test("leaves a call with no procedure to tRPC", () => {
    expect(find("/api/trpc")).toBeUndefined();
    expect(find("/api/trpc/")).toBeUndefined();
  });

  test("ignores inherited object keys", () => {
    expect(find("/api/trpc/toString")).toBe("toString");
  });

  test("leaves a path that can't be decoded to tRPC", () => {
    expect(find("/api/trpc/%E0%A4%A")).toBeUndefined();
  });

  test("keeps the 404 body frozen", () => {
    expect(unknownProcedureBody).toEqual({ code: "UNKNOWN_PROCEDURE", apiCompatibilityLevel });
  });
});
