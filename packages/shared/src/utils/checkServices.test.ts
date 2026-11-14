import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { checkServices } from "./checkServices.ts";

afterEach(() => {
  spyOn(console, "log").mockRestore();
  spyOn(console, "error").mockRestore();
});

describe("checkServices", () => {
  test("names the error code of a failed check without its message", async () => {
    spyOn(console, "log").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});

    await expect(
      checkServices({
        "Map storage": async () => {
          throw Object.assign(new Error("key AKIA-secret is invalid"), {
            name: "InvalidAccessKeyId",
          });
        },
        State: async () => {
          throw Object.assign(new Error("permission denied, open '/state'"), { code: "EACCES" });
        },
        Email: async () => {
          throw new Error("SMTP login failed for secret-user");
        },
      }),
    ).rejects.toThrow("Service connectivity validation failed");

    const output = error.mock.calls.map((call) => String(call[0]));
    expect(output.sort()).toEqual([
      "  Email: failed",
      "  Map storage: failed (InvalidAccessKeyId)",
      "  State: failed (EACCES)",
    ]);
  });
});
