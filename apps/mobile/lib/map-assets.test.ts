import { maplibreVersion } from "./versions.ts";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { PbfReader } from "pbf";
import { PNG } from "pngjs";
import { getProtomapsMapStyle } from "./protomaps-style.ts";

const assets = join(import.meta.dir, "../assets/map");

const fontStacks = (value: unknown): string[][] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Unsupported text-font expression: ${JSON.stringify(value)}`);
  }
  if (value.every((part): part is string => typeof part === "string")) {
    return [value];
  }
  if (value[0] === "literal") {
    return fontStacks(value[1]);
  }
  if (value[0] === "case" && value.length >= 4 && value.length % 2 === 0) {
    return value
      .slice(2)
      .filter((_, index) => index % 2 === 0 || index === value.length - 3)
      .flatMap(fontStacks);
  }
  throw new Error(`Unsupported text-font expression: ${JSON.stringify(value)}`);
};

const findFontStacks = (value: unknown): string[][] => {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(findFontStacks);
  if (Object.hasOwn(value, "text-field") && !Object.hasOwn(value, "text-font")) {
    throw new Error("A text layer uses the unbundled default font stack");
  }
  return Object.entries(value).flatMap(([key, entry]) =>
    key === "text-font" ? fontStacks(entry) : findFontStacks(entry),
  );
};

const iconNames = (
  value: unknown,
  filter: unknown,
  excluded: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): string[] => {
  if (typeof value === "string") return value ? [value] : [];
  if (!Array.isArray(value))
    throw new Error(`Unsupported icon expression: ${JSON.stringify(value)}`);
  if (value[0] === "get") {
    const findValues = (expression: unknown): string[] => {
      if (!Array.isArray(expression)) return [];
      if (
        expression[0] === "in" &&
        JSON.stringify(expression[1]) === JSON.stringify(value) &&
        Array.isArray(expression[2]) &&
        expression[2][0] === "literal" &&
        Array.isArray(expression[2][1]) &&
        expression[2][1].every((item: unknown) => typeof item === "string")
      )
        return expression[2][1] as string[];
      return expression[0] === "all" ? expression.slice(1).flatMap(findValues) : [];
    };
    const values = findValues(filter);
    if (!values.length)
      throw new Error(`Cannot determine icon values for ${JSON.stringify(value)}`);
    return values.filter((item) => !excluded.get(JSON.stringify(value))?.has(item));
  }
  if (value[0] === "literal") return iconNames(value[1], filter, excluded);
  if (value[0] === "case")
    return value
      .slice(2)
      .filter((_, index) => index % 2 === 0 || index === value.length - 3)
      .flatMap((part) => iconNames(part, filter, excluded));
  if (value[0] === "match") {
    const matches = value
      .slice(2, -1)
      .filter((_, index) => index % 2 === 0)
      .flatMap((item) => (Array.isArray(item) ? item : [item]));
    const branches = value
      .slice(3, -1)
      .filter((_, index) => index % 2 === 0)
      .flatMap((part) => iconNames(part, filter, excluded));
    const field = JSON.stringify(value[1]);
    const unmatched = new Map(excluded);
    unmatched.set(
      field,
      new Set([
        ...(excluded.get(field) ?? []),
        ...matches.filter((item): item is string => typeof item === "string"),
      ]),
    );
    return [...branches, ...iconNames(value.at(-1), filter, unmatched)];
  }
  if (value[0] === "step")
    return [value[2], ...value.slice(4).filter((_, index) => index % 2 === 0)].flatMap((part) =>
      iconNames(part, filter, excluded),
    );
  if (value[0] === "concat") {
    return value.slice(1).reduce<string[]>(
      (prefixes, part) => {
        const findLimit = (expression: unknown): number | undefined => {
          if (!Array.isArray(expression)) return undefined;
          if (
            expression[0] === "<=" &&
            JSON.stringify(expression[1]) === JSON.stringify(part) &&
            Number.isInteger(expression[2]) &&
            expression[2] >= 0
          )
            return expression[2];
          return expression[0] === "all"
            ? expression
                .slice(1)
                .map(findLimit)
                .find((limit) => limit !== undefined)
            : undefined;
        };
        const limit = Array.isArray(part) && part[0] === "length" ? findLimit(filter) : undefined;
        if (Array.isArray(part) && part[0] === "length" && limit === undefined)
          throw new Error(`Cannot bound icon length for ${JSON.stringify(part)}`);
        const excludesEmpty = (expression: unknown): boolean => {
          if (!Array.isArray(expression)) return false;
          if (
            expression[0] === ">" &&
            JSON.stringify(expression[1]) === JSON.stringify(part) &&
            expression[2] === 0
          )
            return true;
          return expression[0] === "all" && expression.slice(1).some(excludesEmpty);
        };
        const suffixes =
          limit === undefined
            ? iconNames(part, filter, excluded)
            : Array.from({ length: limit + 1 }, (_, index) => String(index)).filter(
                (item) => item !== "0" || !excludesEmpty(filter),
              );
        return prefixes.flatMap((prefix) => suffixes.map((suffix) => `${prefix}${suffix}`));
      },
      [""],
    );
  }
  throw new Error(`Unsupported icon expression: ${JSON.stringify(value)}`);
};

describe("bundled map assets", () => {
  test("rejects text layers that use MapLibre's unbundled default font stack", () => {
    expect(() => findFontStacks({ layout: { "text-field": ["get", "name"] } })).toThrow(
      "A text layer uses the unbundled default font stack",
    );
    expect(
      findFontStacks({ layout: { "text-field": "name", "text-font": ["Noto Sans Regular"] } }),
    ).toEqual([["Noto Sans Regular"]]);
  });

  test("uses the renderer and style versions reviewed with these assets", () => {
    expect(maplibreVersion).toBe("11.5.1");
    for (const [name, reviewedVersion] of [
      ["@maplibre/maplibre-react-native", "11.5.1"],
      ["@protomaps/basemaps", "5.7.2"],
    ] as const) {
      const metadata: { version: string } = JSON.parse(
        readFileSync(new URL(import.meta.resolve(`${name}/package.json`)), "utf8"),
      );
      expect(metadata.version).toBe(reviewedVersion);
    }
  });

  test("detects data-driven icon names and rejects unbounded sources", () => {
    const expression = ["match", ["get", "kind"], "station", "train_station", ["get", "kind"]];
    const filter = ["all", ["in", ["get", "kind"], ["literal", ["station", "new_icon"]]]];
    expect(iconNames(expression, filter)).toEqual(["train_station", "new_icon"]);
    expect(() => iconNames(["get", "kind"], ["has", "kind"])).toThrow(
      "Cannot determine icon values",
    );
    expect(() =>
      iconNames(["concat", "shield-", ["length", ["get", "ref"]]], ["has", "ref"]),
    ).toThrow("Cannot bound icon length");
  });

  test("matches the reviewed asset set", () => {
    const files = readdirSync(assets, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(pbf|json|png)$/.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();
    const hash = createHash("sha256");
    for (const file of files) {
      hash.update(relative(assets, file)).update("\0").update(readFileSync(file)).update("\0");
    }
    expect(hash.digest("hex")).toBe(
      "b689d0e505ba55295b5e540b5f922519d64e66669f9ec920e8a1d05e7bdc7341",
    );
  });
  test("every generated font stack contains valid glyph ranges", () => {
    const stacks = new Set(
      (["light", "dark"] as const).flatMap((theme) =>
        findFontStacks(getProtomapsMapStyle(theme, "tiles", "fonts", "sprites", true).layers).map(
          (stack) => stack.join(","),
        ),
      ),
    );
    expect(stacks.size).toBeGreaterThan(0);
    expect(stacks.has("Noto Sans Devanagari Regular v1")).toBe(true);

    const positionedGlyphs: Record<number, number> = {
      62720: 62844,
      62976: 62976,
      63232: 63232,
      63488: 63488,
    };
    for (const stack of stacks) {
      for (let start = 0; start < 65536; start += 256) {
        const range = `${start}-${start + 255}`;
        const path = join(assets, "fonts", stack, `${range}.pbf`);
        const reader = new PbfReader(readFileSync(path));
        const result = reader.readFields(
          (tag, result, pbf) => {
            if (tag !== 1) throw new Error(`Unexpected glyphs field ${tag} in ${path}`);
            pbf.readMessage((field, font, message) => {
              if (field === 1) font.name = message.readString();
              else if (field === 2) font.range = message.readString();
              else if (field === 3) {
                const glyph = message.readMessage(
                  (glyphField, item, data) => {
                    if (glyphField === 1) item.id = data.readVarint();
                    else if (glyphField === 2) item.bitmapLength = data.readBytes().length;
                    else if (glyphField === 3) item.width = data.readVarint();
                    else if (glyphField === 4) item.height = data.readVarint();
                    else if (glyphField === 5 || glyphField === 6) data.readSVarint();
                    else if (glyphField === 7) data.readVarint();
                    else throw new Error(`Unexpected glyph field ${glyphField} in ${path}`);
                  },
                  { id: 0, width: 0, height: 0, bitmapLength: 0 },
                );
                if (glyph.id < start || glyph.id >= start + 256)
                  throw new Error(`Glyph ${glyph.id} outside ${range} in ${path}`);
                if (
                  glyph.bitmapLength &&
                  glyph.bitmapLength !== (glyph.width + 6) * (glyph.height + 6)
                )
                  throw new Error(`Invalid glyph bitmap in ${path}`);
                font.count++;
                if (glyph.id === positionedGlyphs[start] && glyph.bitmapLength > 0) {
                  font.positionedGlyph = true;
                }
              } else throw new Error(`Unexpected font field ${field} in ${path}`);
            }, result);
          },
          { name: "", range: "", count: 0, positionedGlyph: false },
        );
        expect(result.name).not.toBe("");
        expect(result.range).toBe(range);
        if (
          (stack === "Noto Sans Regular" && start === 0) ||
          (stack === "Noto Sans Devanagari Regular v1" && start === 2304)
        ) {
          expect(result.count).toBeGreaterThan(0);
        }
        if (stack === "Noto Sans Devanagari Regular v1" && start >= 62720 && start <= 63488) {
          expect(result.positionedGlyph).toBe(true);
        }
      }
    }
  });

  test("sprites decode and their indexes fit both density images", () => {
    let names: string[] | undefined;
    for (const theme of ["light", "dark"] as const) {
      for (const density of [1, 2] as const) {
        const path = join(assets, "sprites", `${theme}${density === 2 ? "@2x" : ""}`);
        const image = PNG.sync.read(readFileSync(`${path}.png`));
        const entries: Record<
          string,
          { x: number; y: number; width: number; height: number; pixelRatio: number }
        > = JSON.parse(readFileSync(`${path}.json`, "utf8"));
        const currentNames = Object.keys(entries).sort();
        expect(currentNames.length).toBeGreaterThan(0);
        if (names) expect(currentNames).toEqual(names);
        else names = currentNames;
        for (const [name, sprite] of Object.entries(entries)) {
          expect(
            Number.isInteger(sprite.x) &&
              sprite.x >= 0 &&
              Number.isInteger(sprite.y) &&
              sprite.y >= 0,
          ).toBe(true);
          expect(sprite.width).toBeGreaterThan(0);
          expect(sprite.height).toBeGreaterThan(0);
          expect(sprite.x + sprite.width).toBeLessThanOrEqual(image.width);
          expect(sprite.y + sprite.height).toBeLessThanOrEqual(image.height);
          expect(sprite.pixelRatio).toBe(density);
          let visible = false;
          for (let y = sprite.y; y < sprite.y + sprite.height && !visible; y++) {
            for (let x = sprite.x; x < sprite.x + sprite.width; x++) {
              if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) > 0) {
                visible = true;
                break;
              }
            }
          }
          expect(visible).toBe(true);
          if (!name) throw new Error(`Empty sprite name in ${path}`);
        }
      }
    }
    for (const theme of ["light", "dark"] as const) {
      const style = getProtomapsMapStyle(theme, "tiles", "fonts", "sprites", true);
      for (const layer of style.layers) {
        for (const [key, value] of Object.entries({ ...layer.layout, ...layer.paint })) {
          if (
            [
              "icon-image",
              "fill-pattern",
              "line-pattern",
              "background-pattern",
              "fill-extrusion-pattern",
            ].includes(key)
          ) {
            for (const name of iconNames(value, "filter" in layer ? layer.filter : undefined))
              expect(names).toContain(name);
          }
        }
      }
    }
  });
});
