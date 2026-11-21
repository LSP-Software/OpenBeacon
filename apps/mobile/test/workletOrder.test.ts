import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const sourceFiles = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

test("module-level worklets only call worklets declared above them", () => {
  const files = ["app", "components", "hooks", "lib"].flatMap(sourceFiles);
  const problems = files.flatMap((path) => {
    const source = readFileSync(join(root, path), "utf8");
    const declarations = [...source.matchAll(/^(?:export )?const (\w+) = /gm)].map(
      (match, index, all) => ({
        body: source.slice(match.index, all[index + 1]?.index ?? source.length),
        name: match[1] ?? "",
      }),
    );
    const worklets = declarations.filter((declaration) => declaration.body.includes('"worklet"'));
    return worklets.flatMap((worklet, index) =>
      worklets
        .slice(index + 1)
        .filter((later) => new RegExp(`\\b${later.name}\\(`).test(worklet.body))
        .map((later) => `${path}: ${worklet.name} calls ${later.name} before it is declared`),
    );
  });

  expect(problems).toEqual([]);
});
