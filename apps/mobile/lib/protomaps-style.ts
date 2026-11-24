import { layers, namedFlavor } from "@protomaps/basemaps";
import type { ResolvedTheme } from "./themePreferences.ts";

export const getProtomapsLayers = (variant: ResolvedTheme, showSymbols: boolean) =>
  layers("protomaps", namedFlavor(variant), { lang: "en" }).map((layer) => {
    if (layer.type !== "symbol") return layer;
    const iconImage =
      layer.id === "pois"
        ? ["match", ["get", "kind"], "townhall", "building", layer.layout?.["icon-image"]]
        : layer.layout?.["icon-image"];
    const layout = {
      ...layer.layout,
      visibility: showSymbols ? ("visible" as const) : ("none" as const),
    };
    if (iconImage !== undefined) {
      layout["icon-image"] = prefixSpriteImage(iconImage, variant) as NonNullable<
        (typeof layout)["icon-image"]
      >;
    }
    const symbolLayer = { ...layer, layout };
    if (layer.id !== "roads_shields") return symbolLayer;
    return {
      ...symbolLayer,
      filter: ["all", layer.filter, [">", ["length", ["get", "shield_text"]], 0]] as NonNullable<
        typeof layer.filter
      >,
    };
  });

export const getProtomapsThemeLayers = (variant: ResolvedTheme, showSymbols: boolean) =>
  getProtomapsLayers(variant, showSymbols).map(
    ({ id, type, paint, layout }) =>
      ({
        id,
        type,
        ...(paint === undefined ? {} : { paint }),
        ...(layout === undefined ? {} : { layout }),
      }) as ThemeLayer<ProtomapsLayer>,
  );

export const getProtomapsMapStyle = (
  variant: ResolvedTheme,
  pmtilesUrl: string,
  glyphsUrl: string,
  spritesUrl: string,
  showSymbols: boolean,
) => ({
  version: 8 as const,
  sources: {
    protomaps: {
      type: "vector" as const,
      attribution:
        '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://osm.org/copyright">OpenStreetMap</a>',
      url: `pmtiles://${pmtilesUrl}`,
    },
  },
  layers: getProtomapsLayers(variant, showSymbols),
  glyphs: glyphsUrl,
  sprite: (["light", "dark"] as const).map((id) => ({ id, url: `${spritesUrl}/${id}` })),
});

export const prefixSpriteImage = (value: unknown, sprite: ResolvedTheme): unknown => {
  if (typeof value === "string") return value ? `${sprite}:${value}` : value;
  if (!Array.isArray(value)) throw new Error(`Unsupported icon: ${JSON.stringify(value)}`);
  const [operator, ...args] = value;
  if (operator === "match")
    return [
      operator,
      args[0],
      ...args
        .slice(1, -1)
        .map((arg, index) => (index % 2 === 1 ? prefixSpriteImage(arg, sprite) : arg)),
      prefixSpriteImage(args.at(-1), sprite),
    ];
  if (operator === "case")
    return [
      operator,
      ...args
        .slice(0, -1)
        .map((arg, index) => (index % 2 === 1 ? prefixSpriteImage(arg, sprite) : arg)),
      prefixSpriteImage(args.at(-1), sprite),
    ];
  if (operator === "step")
    return [
      operator,
      args[0],
      ...args
        .slice(1)
        .map((arg, index) => (index % 2 === 0 ? prefixSpriteImage(arg, sprite) : arg)),
    ];
  if (operator === "concat") return [operator, `${sprite}:`, ...args];
  if (operator === "get") return ["concat", `${sprite}:`, value];
  throw new Error(`Unsupported icon expression: ${JSON.stringify(value)}`);
};

type ProtomapsLayer = ReturnType<typeof getProtomapsLayers>[number];

type ThemeLayer<T> = T extends ProtomapsLayer ? Pick<T, "id" | "type" | "paint" | "layout"> : never;
