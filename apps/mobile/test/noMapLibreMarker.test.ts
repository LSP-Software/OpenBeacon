import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const sourceFiles = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return ["node_modules", "android", "ios", "test", "build"].includes(entry.name)
        ? []
        : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

test("maps never use MapLibre's Marker, which unclips Android ViewAnnotation views at the map's top-left", () => {
  const users = sourceFiles(".").filter((path) => {
    const source = readFileSync(join(root, path), "utf8");
    return /["']@maplibre\/maplibre-react-native["']/.test(source) && /\bMarker\b/.test(source);
  });

  expect(users).toEqual([]);
});
