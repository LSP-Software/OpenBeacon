import { describe, expect, test } from "bun:test";
import { hasPmtilesArchiveChanged } from "./pmtilesUrl.ts";

describe("hasPmtilesArchiveChanged", () => {
  test("does not remount for the first archive or a refreshed url for the same archive", () => {
    expect(hasPmtilesArchiveChanged({ appliedArchiveKey: null, archiveKey: "a" })).toBe(false);
    expect(hasPmtilesArchiveChanged({ appliedArchiveKey: "a", archiveKey: "a" })).toBe(false);
  });

  test("remounts when the server moves the map to another archive", () => {
    expect(hasPmtilesArchiveChanged({ appliedArchiveKey: "a", archiveKey: "b" })).toBe(true);
  });

  test("does not remount when a backend does not report archives", () => {
    expect(hasPmtilesArchiveChanged({ appliedArchiveKey: "a", archiveKey: null })).toBe(false);
  });
});
