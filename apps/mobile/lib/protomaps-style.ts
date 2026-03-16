import { layers, namedFlavor } from "@protomaps/basemaps";

const ATTRIBUTION =
  '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://osm.org/copyright">OpenStreetMap</a>';
const GLYPHS_URL = "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
const SPRITE_BASE_URL = "https://protomaps.github.io/basemaps-assets/sprites/v4";

export const getProtomapsMapStyle = (variant: "light" | "dark", pmtilesUrl: string) => {
  return {
    version: 8,
    sources: {
      protomaps: {
        type: "vector",
        attribution: ATTRIBUTION,
        url: `pmtiles://${pmtilesUrl}`,
      },
    },
    layers: layers("protomaps", namedFlavor(variant), { lang: "en" }),
    glyphs: GLYPHS_URL,
    sprite: `${SPRITE_BASE_URL}/${variant}`,
  };
};
