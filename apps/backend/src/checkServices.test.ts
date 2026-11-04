import { describe, expect, test } from "bun:test";
import { checkServices } from "./checkServices.ts";

describe("startup service checks", () => {
  test("accepts successful checks", async () => {
    await expect(
      checkServices({ S3: async () => {}, R2: async () => {} }),
    ).resolves.toBeUndefined();
  });

  test("runs all checks and rejects when any service fails", async () => {
    const checked: string[] = [];
    await expect(
      checkServices({
        S3: async () => {
          checked.push("S3");
          throw new Error("private credentials");
        },
        R2: async () => {
          checked.push("R2");
        },
      }),
    ).rejects.toThrow("Service connectivity validation failed");
    expect(checked.sort()).toEqual(["R2", "S3"]);
  });
});
