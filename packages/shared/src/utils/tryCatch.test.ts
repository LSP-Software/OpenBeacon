import { expect, test } from "bun:test";
import { tryCatch } from "./tryCatch.ts";

test("a rejection with a falsy or primitive value is still a failure with a message", async () => {
  for (const value of [undefined, null, 0, "", false, "boom"]) {
    const result = await tryCatch(Promise.reject(value));
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe(String(value));
    expect(result.error?.cause).toBe(value);
    expect(result.data).toBeNull();
  }
});

test("a rejected Error or object is passed through unchanged", async () => {
  const error = new Error("failed");
  expect((await tryCatch(Promise.reject(error))).error).toBe(error);
  const shaped = { code: "E_SHAPED", message: "shaped" };
  expect((await tryCatch(Promise.reject(shaped))).error).toBe(shaped as unknown as Error);
});

test("a resolved value is data, even when it is falsy", async () => {
  expect(await tryCatch(Promise.resolve(0))).toEqual({ data: 0, error: null });
});
