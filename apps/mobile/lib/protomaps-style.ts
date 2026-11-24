import { type Flavor, layers, namedFlavor } from "@protomaps/basemaps";
import type { ResolvedTheme } from "./themePreferences.ts";

const darkEarth = "#1A2029";
const darkCasing = "#10151C";

const darkFlavor: Flavor = {
  background: "#141A22",
  earth: darkEarth,
  park_a: "#1B2A25",
  park_b: "#1E3329",
  hospital: "#271F27",
  industrial: "#1C222A",
  school: "#23222C",
  wood_a: "#1C2923",
  wood_b: "#1E2F27",
  pedestrian: "#212833",
  scrub_a: "#1D2826",
  scrub_b: "#1F2D28",
  glacier: "#232A33",
  sand: "#26261F",
  beach: "#2A2920",
  aerodrome: "#1E242C",
  runway: "#2E3641",
  water: "#13344D",
  zoo: "#1D2A28",
  military: "#222429",

  tunnel_other_casing: darkEarth,
  tunnel_minor_casing: darkEarth,
  tunnel_link_casing: darkEarth,
  tunnel_major_casing: darkEarth,
  tunnel_highway_casing: darkEarth,
  tunnel_other: "#2A313C",
  tunnel_minor: "#2A313C",
  tunnel_link: "#2E3542",
  tunnel_major: "#323A48",
  tunnel_highway: "#363F4E",

  pier: "#2A313C",
  buildings: "#303A48",

  minor_service_casing: darkCasing,
  minor_casing: darkCasing,
  link_casing: darkCasing,
  major_casing_late: darkCasing,
  highway_casing_late: darkCasing,
  other: "#2C333E",
  minor_service: "#303845",
  minor_a: "#3A4350",
  minor_b: "#3F4957",
  link: "#4A5465",
  major_casing_early: darkCasing,
  major: "#505B6D",
  highway_casing_early: darkCasing,
  highway: "#5F6B80",

  railway: "#46505F",
  boundaries: "#6B7486",

  bridges_other_casing: darkCasing,
  bridges_minor_casing: darkCasing,
  bridges_link_casing: darkCasing,
  bridges_major_casing: darkCasing,
  bridges_highway_casing: darkCasing,
  bridges_other: "#2C333E",
  bridges_minor: "#3F4957",
  bridges_link: "#4A5465",
  bridges_major: "#505B6D",
  bridges_highway: "#5F6B80",

  roads_label_minor: "#C3CAD4",
  roads_label_minor_halo: darkEarth,
  roads_label_major: "#E6E9EE",
  roads_label_major_halo: darkEarth,
  ocean_label: "#9CC4E2",
  subplace_label: "#9EA8B6",
  subplace_label_halo: darkEarth,
  city_label: "#F1F3F6",
  city_label_halo: "#141A22",
  state_label: "#8E98A6",
  state_label_halo: darkEarth,
  country_label: "#9EA8B6",

  address_label: "#8E98A6",
  address_label_halo: darkEarth,

  pois: {
    blue: "#5AB0D6",
    green: "#4FCF8A",
    lapis: "#7C9AF7",
    pink: "#F07BC8",
    red: "#F47B95",
    slategray: "#A9A9B8",
    tangerine: "#F4AE84",
    turquoise: "#3CD2E0",
  },

  landcover: {
    grassland: "#1C2A24",
    barren: "#24251F",
    urban_area: "#1C222B",
    farmland: "#1E2822",
    glacier: "#262C34",
    scrub: "#1F2923",
    forest: "#1A2A22",
  },
};

export const getProtomapsLayers = (variant: ResolvedTheme, showSymbols: boolean) =>
  layers("protomaps", variant === "dark" ? darkFlavor : namedFlavor("light"), {
    lang: "en",
  }).map((layer) => {
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
    const symbolLayer = {
      ...layer,
      layout,
      ...(variant === "dark" && layer.paint?.["text-halo-width"] !== undefined
        ? { paint: { ...layer.paint, "text-halo-width": 1.5 } }
        : {}),
    };
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
