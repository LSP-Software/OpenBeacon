import { describe, expect, test } from "bun:test";

describe("Expo authentication origin", () => {
  test("accepts the configured native origin and rejects untrusted origins", async () => {
    process.env["NODE_ENV"] = "production";
    const { auth } = await import("./index.ts");
    const request = (origin: string) =>
      auth.handler(
        new Request(`${process.env["BETTER_AUTH_URL"]}/api/auth/sign-up/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: "test=1",
            "expo-origin": origin,
          },
          body: JSON.stringify({ name: "Test", email: "invalid", password: "test-password" }),
        }),
      );

    const trusted = await request("openbeacon://");
    expect(trusted.status).toBe(400);
    expect((await trusted.json()).code).toBe("VALIDATION_ERROR");

    const untrusted = await request("untrusted://");
    expect(untrusted.status).toBe(403);
    expect((await untrusted.json()).code).toBe("INVALID_ORIGIN");
  });
});
