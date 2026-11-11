import { expect, test } from "bun:test";
import { envSchema } from "./envSchema.ts";

test("treats a backend as self-hosted unless SELF_HOSTED is explicitly false", () => {
  expect(envSchema.SELF_HOSTED.parse(undefined)).toBe(true);
  expect(envSchema.SELF_HOSTED.parse("")).toBe(true);
  expect(envSchema.SELF_HOSTED.parse("true")).toBe(true);
  expect(envSchema.SELF_HOSTED.parse("false")).toBe(false);
  expect(envSchema.SELF_HOSTED.safeParse("maybe").success).toBe(false);
});

test("leaves the email code IP limit off unless EMAIL_CODE_IP_LIMIT is true", () => {
  expect(envSchema.EMAIL_CODE_IP_LIMIT.parse(undefined)).toBe(false);
  expect(envSchema.EMAIL_CODE_IP_LIMIT.parse("")).toBe(false);
  expect(envSchema.EMAIL_CODE_IP_LIMIT.parse("true")).toBe(true);
  expect(envSchema.EMAIL_CODE_IP_LIMIT.safeParse("maybe").success).toBe(false);
});

test("only accepts a Discord webhook URL for feedback alerts and treats empty as unset", () => {
  const schema = envSchema.DISCORD_FEEDBACK_WEBHOOK_URL;
  expect(schema.parse(undefined)).toBeUndefined();
  expect(schema.parse("")).toBeUndefined();
  for (const url of [
    "https://discord.com/api/webhooks/1/token",
    "https://discordapp.com/api/webhooks/1/token",
    "https://ptb.discord.com/api/webhooks/1/token",
    "https://canary.discord.com/api/webhooks/1/token",
  ]) {
    expect(schema.parse(url)).toBe(url);
  }
  for (const url of [
    "http://discord.com/api/webhooks/1/token",
    "https://example.com/api/webhooks/1/token",
    "https://discord.com.evil.test/api/webhooks/1/token",
    "https://evil.discord.com/api/webhooks/1/token",
    "https://discord.com/api/other/1/token",
    "https://discord.com/webhooks/1/token",
    "https://user:pass@discord.com/api/webhooks/1/token",
    "https://user@discord.com/api/webhooks/1/token",
    "https://discord.com:8443/api/webhooks/1/token",
    "not a url",
  ]) {
    expect(schema.safeParse(url).success).toBe(false);
  }
});

test("does not echo the Discord webhook URL in validation errors", () => {
  const secret = "https://example.com/api/webhooks/1/secret-token";
  const result = envSchema.DISCORD_FEEDBACK_WEBHOOK_URL.safeParse(secret);
  expect(result.success).toBe(false);
  expect(JSON.stringify(result.error?.issues)).not.toContain("secret-token");
});
