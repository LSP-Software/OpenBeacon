import { describe, expect, test } from "bun:test";
import { assertWriteTarget } from "./index.ts";

describe("assertWriteTarget", () => {
  test("refuses writes unless the bucket is named explicitly", () => {
    expect(() => assertWriteTarget({ bucket: undefined, configuredBucket: "map-tiles" })).toThrow(
      "pass --bucket map-tiles",
    );
    expect(() => assertWriteTarget({ bucket: "other", configuredBucket: "map-tiles" })).toThrow(
      "Refusing to write",
    );
  });

  test("allows writes to the configured bucket", () => {
    expect(() =>
      assertWriteTarget({ bucket: "map-tiles", configuredBucket: "map-tiles" }),
    ).not.toThrow();
  });
});
