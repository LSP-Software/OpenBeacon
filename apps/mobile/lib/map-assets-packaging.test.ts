import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileModsAsync } from "expo/config-plugins";

const require = createRequire(import.meta.url);
const withMapFonts = require("../plugins/withMapFonts.js") as (
  config: Parameters<typeof compileModsAsync>[0],
) => Parameters<typeof compileModsAsync>[0];

describe("map asset packaging", () => {
  test("iOS prebuild adds the map folder as a resource exactly once", async () => {
    const root = mkdtempSync(join(tmpdir(), "openbeacon-map-ios-"));
    try {
      const template = join(dirname(require.resolve("expo/package.json")), "template.tgz");
      const extract = Bun.spawnSync([
        "tar",
        "-xzf",
        template,
        "-C",
        root,
        "--strip-components=1",
        "package/ios",
      ]);
      expect(extract.exitCode).toBe(0);
      for (let pass = 0; pass < 2; pass++) {
        await compileModsAsync(withMapFonts({ name: "Test", slug: "test" }), {
          projectRoot: root,
          platforms: ["ios"],
        });
      }
      const project = readFileSync(join(root, "ios/HelloWorld.xcodeproj/project.pbxproj"), "utf8");
      expect(project.match(/\/\* map in Resources \*\/ =/g)).toHaveLength(1);
      expect(project).toMatch(/path = "\.\.\/assets\/map";.*lastKnownFileType = folder/);
      expect(project).toMatch(/\/\* map in Resources \*\/[,;]/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Android prebuild copies glyphs and sprites to the paths used by the map", async () => {
    const root = mkdtempSync(join(tmpdir(), "openbeacon-map-mod-"));
    try {
      const source = join(root, "assets/map");
      const destination = join(root, "android/app/src/main/assets");
      mkdirSync(join(source, "fonts/Test Font"), { recursive: true });
      mkdirSync(join(source, "sprites"), { recursive: true });
      mkdirSync(join(destination, "map-fonts"), { recursive: true });
      writeFileSync(join(source, "fonts/Test Font/0-255.pbf"), "glyph");
      writeFileSync(join(source, "sprites/light@2x.png"), "sprite");
      writeFileSync(join(destination, "map-fonts/old"), "old");

      await compileModsAsync(withMapFonts({ name: "Test", slug: "test" }), {
        projectRoot: root,
        platforms: ["android"],
      });

      expect(readFileSync(join(destination, "map-assets/fonts/Test Font/0-255.pbf"), "utf8")).toBe(
        "glyph",
      );
      expect(readFileSync(join(destination, "map-assets/sprites/light@2x.png"), "utf8")).toBe(
        "sprite",
      );
      expect(() => readFileSync(join(destination, "map-fonts/old"))).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
