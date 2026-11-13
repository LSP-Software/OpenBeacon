import { describe, expect, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import { errorReason } from "./errorReason.ts";

describe("errorReason", () => {
  test("reads a known reason from a tRPC error", () => {
    const error = new TRPCClientError("Too many requests", {
      result: {
        error: {
          code: -32029,
          message: "Too many requests",
          data: { code: "TOO_MANY_REQUESTS", httpStatus: 429, reason: "UPLOAD_LIMIT_REACHED" },
        },
      },
    });
    expect(errorReason(error)).toBe("UPLOAD_LIMIT_REACHED");
  });

  test("reads a known better-auth error code", () => {
    expect(errorReason({ code: "TOO_MANY_PASSWORD_ATTEMPTS", message: "Try again later" })).toBe(
      "TOO_MANY_PASSWORD_ATTEMPTS",
    );
  });

  test("ignores unknown reasons, codes and errors without data", () => {
    expect(errorReason({ data: { code: "FORBIDDEN", reason: "SOMETHING_NEW" } })).toBeNull();
    expect(errorReason({ data: { code: "FORBIDDEN", reason: null } })).toBeNull();
    expect(errorReason({ code: "INVALID_CODE" })).toBeNull();
    expect(errorReason(new Error("GROUP_GONE"))).toBeNull();
    expect(errorReason(null)).toBeNull();
  });
});
