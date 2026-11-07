import { expect, test } from "bun:test";
import { envSchema } from "./envSchema.ts";

test("treats a backend as self-hosted unless SELF_HOSTED is explicitly false", () => {
  expect(envSchema.SELF_HOSTED.parse(undefined)).toBe(true);
  expect(envSchema.SELF_HOSTED.parse("")).toBe(true);
  expect(envSchema.SELF_HOSTED.parse("true")).toBe(true);
  expect(envSchema.SELF_HOSTED.parse("false")).toBe(false);
  expect(envSchema.SELF_HOSTED.safeParse("maybe").success).toBe(false);
});
