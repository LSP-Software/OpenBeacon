const { describe, expect, test } = require("bun:test");
const { markPortraitScreenOptional } = require("./withOptionalPortraitScreen.js");

const portrait = {
  $: { "android:name": "android.hardware.screen.portrait", "android:required": "false" },
};

describe("withOptionalPortraitScreen", () => {
  test("declares the portrait screen as optional so Play does not require it", () => {
    expect(markPortraitScreenOptional({ manifest: {} }).manifest["uses-feature"]).toEqual([
      portrait,
    ]);
  });

  test("keeps other features and replaces an existing portrait declaration", () => {
    const camera = {
      $: { "android:name": "android.hardware.camera", "android:required": "false" },
    };
    const manifest = {
      manifest: {
        "uses-feature": [
          camera,
          { $: { "android:name": "android.hardware.screen.portrait", "android:required": "true" } },
        ],
      },
    };
    const once = markPortraitScreenOptional(manifest);
    expect(once.manifest["uses-feature"]).toEqual([camera, portrait]);
    expect(markPortraitScreenOptional(once).manifest["uses-feature"]).toEqual([camera, portrait]);
  });
});
