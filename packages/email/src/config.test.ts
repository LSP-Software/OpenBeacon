import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { emailEnvSchema, resolveEmailConfig } from "./config.ts";

const resolve = (values: Record<string, string>, nodeEnv = "production") =>
  resolveEmailConfig({ ...z.object(emailEnvSchema).parse(values), NODE_ENV: nodeEnv });

describe("resolveEmailConfig", () => {
  test("turns email off when no provider is configured", () => {
    expect(resolve({})).toEqual({ transport: "none" });
    expect(resolve({ RESEND_API_KEY: " ", SMTP_HOST: "", EMAIL_FROM: "" })).toEqual({
      transport: "none",
    });
  });

  test("configures Resend", () => {
    expect(resolve({ RESEND_API_KEY: "re_key", EMAIL_FROM: "noreply@example.com" })).toEqual({
      transport: "resend",
      fromAddress: "noreply@example.com",
      apiKey: "re_key",
    });
  });

  test("configures SMTP with STARTTLS on port 587 by default", () => {
    expect(
      resolve({
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "user",
        SMTP_PASSWORD: "password",
        EMAIL_FROM: "noreply@example.com",
      }),
    ).toEqual({
      transport: "smtp",
      fromAddress: "noreply@example.com",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTls: true,
      auth: { user: "user", pass: "password" },
    });
  });

  test("lets SMTP_REQUIRE_TLS=false allow a plaintext relay", () => {
    const base = { SMTP_HOST: "relay.local", EMAIL_FROM: "noreply@example.com" };
    expect(resolve({ ...base, SMTP_REQUIRE_TLS: "false" })).toMatchObject({
      secure: false,
      requireTls: false,
    });
    expect(resolve({ ...base, SMTP_REQUIRE_TLS: "true" })).toMatchObject({ requireTls: true });
    expect(resolve({ ...base, SMTP_REQUIRE_TLS: "false", SMTP_PORT: "465" })).toMatchObject({
      secure: true,
      requireTls: false,
    });
    expect(() => resolve({ SMTP_REQUIRE_TLS: "false" })).toThrow("SMTP settings need SMTP_HOST");
  });

  test("uses implicit TLS for SMTP on port 465 or when SMTP_SECURE is set", () => {
    const base = { SMTP_HOST: "smtp.example.com", EMAIL_FROM: "noreply@example.com" };
    expect(resolve({ ...base, SMTP_PORT: "465" })).toMatchObject({ port: 465, secure: true });
    expect(resolve({ ...base, SMTP_SECURE: "true" })).toMatchObject({ port: 465, secure: true });
    expect(resolve({ ...base, SMTP_PORT: "2525" })).toMatchObject({
      port: 2525,
      secure: false,
      requireTls: true,
      auth: null,
    });
  });

  test("rejects Resend and SMTP together", () => {
    expect(() =>
      resolve({
        RESEND_API_KEY: "re_key",
        SMTP_HOST: "smtp.example.com",
        EMAIL_FROM: "noreply@example.com",
      }),
    ).toThrow("Set either RESEND_API_KEY or SMTP_HOST, not both");
  });

  test("rejects incomplete provider settings", () => {
    expect(() => resolve({ RESEND_API_KEY: "re_key" })).toThrow("EMAIL_FROM must be a valid email");
    expect(() => resolve({ SMTP_HOST: "smtp.example.com" })).toThrow(
      "EMAIL_FROM must be a valid email",
    );
    expect(() => resolve({ SMTP_USER: "user" })).toThrow("SMTP settings need SMTP_HOST");
    expect(() =>
      resolve({
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "user",
        EMAIL_FROM: "noreply@example.com",
      }),
    ).toThrow("SMTP_USER and SMTP_PASSWORD must be set together");
  });

  test("rejects EMAIL_FROM without a provider, unless printing to the console", () => {
    expect(() => resolve({ EMAIL_FROM: "noreply@example.com" })).toThrow(
      "EMAIL_FROM needs RESEND_API_KEY or SMTP_HOST",
    );
    expect(
      resolve({ EMAIL_CONSOLE: "true", EMAIL_FROM: "dev@example.com" }, "development"),
    ).toEqual({ transport: "console", fromAddress: "dev@example.com" });
  });

  test("checks EMAIL_FROM is a plain address when Resend or SMTP is configured", () => {
    for (const provider of [{ RESEND_API_KEY: "re_key" }, { SMTP_HOST: "smtp.example.com" }]) {
      expect(() => resolve({ ...provider, EMAIL_FROM: "not-an-email" })).toThrow(
        "EMAIL_FROM must be a valid email address when Resend or SMTP is configured",
      );
      expect(() => resolve({ ...provider, EMAIL_FROM: "Evil <a@example.com>" })).toThrow();
    }
  });

  test("rejects invalid values", () => {
    expect(() => resolve({ SMTP_PORT: "70000" })).toThrow();
  });

  test("allows the console transport only in development and test", () => {
    expect(resolve({ EMAIL_CONSOLE: "true" }, "development")).toEqual({
      transport: "console",
      fromAddress: "noreply@localhost",
    });
    expect(resolve({ EMAIL_CONSOLE: "true" }, "test")).toMatchObject({ transport: "console" });
    expect(() => resolve({ EMAIL_CONSOLE: "true" }, "production")).toThrow(
      "EMAIL_CONSOLE is only allowed when NODE_ENV is development or test",
    );
    expect(() => resolve({ EMAIL_CONSOLE: "true" }, "")).toThrow();
    expect(() =>
      resolve(
        { EMAIL_CONSOLE: "true", RESEND_API_KEY: "re_key", EMAIL_FROM: "noreply@example.com" },
        "development",
      ),
    ).toThrow("EMAIL_CONSOLE cannot be combined");
  });
});
