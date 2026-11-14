import { describe, expect, test } from "bun:test";
import { checkServices } from "./checkServices.ts";

describe("startup service checks", () => {
  test("accepts successful checks", async () => {
    await expect(
      checkServices({ S3: async () => {}, "Map storage": async () => {} }),
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
        "Map storage": async () => {
          checked.push("Map storage");
        },
      }),
    ).rejects.toThrow("Service connectivity validation failed");
    expect(checked.sort()).toEqual(["Map storage", "S3"]);
  });
});
