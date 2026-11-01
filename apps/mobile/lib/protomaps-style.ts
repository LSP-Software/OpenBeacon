import { layers, namedFlavor } from "@protomaps/basemaps";

export const getProtomapsMapStyle = (
  variant: "light" | "dark",
  pmtilesUrl: string,
  glyphsUrl: string,
  showSymbols = false,
) => {
  return {
    version: 8,
    sources: {
      protomaps: {
        type: "vector",
        attribution:
          '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://osm.org/copyright">OpenStreetMap</a>',
        url: `pmtiles://${pmtilesUrl}`,
      },
    },
    layers: layers("protomaps", namedFlavor(variant), { lang: "en" }).filter(
      (layer) => showSymbols || layer.type !== "symbol",
    ),
    glyphs: glyphsUrl,
    sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${variant}`,
  };
};
