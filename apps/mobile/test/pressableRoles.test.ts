import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

const sourceFiles = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });

const openingTag = (source: string, start: number) => {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (character === "{") depth++;
    if (character === "}") depth--;
    if (character === ">" && depth === 0 && source[index - 1] !== "=") {
      return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
};

const parentGivesRole = (source: string, start: number) => {
  const parentStart = source.slice(0, start).search(/<[A-Za-z.]+[^<]*$/);
  const parent = openingTag(source, parentStart);
  return /^<(Link|[A-Za-z.]*Trigger)\b/.test(parent) && parent.includes("asChild");
};

test("every Pressable tells screen readers what it is", () => {
  const unnamed = ["app", "components", "providers"].flatMap((dir) =>
    sourceFiles(dir).flatMap((path) => {
      const source = readFileSync(join(root, path), "utf8");
      return [...source.matchAll(/<Pressable\b/g)]
        .filter(({ index }) => !parentGivesRole(source, index))
        .map(({ index }) => openingTag(source, index))
        .filter((tag) => !/accessibilityRole=|\brole=|accessible=\{false\}/.test(tag))
        .map((tag) => `${path}: ${tag.split("\n")[0]}`);
    }),
  );

  expect(unnamed).toEqual([]);
});
