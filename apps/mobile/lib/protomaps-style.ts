import { layers, namedFlavor } from "@protomaps/basemaps";

export const getProtomapsMapStyle = (
  variant: "light" | "dark",
  pmtilesUrl: string,
  glyphsUrl: string,
  spritesUrl: string,
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
    layers: layers("protomaps", namedFlavor(variant), { lang: "en" })
      .filter((layer) => showSymbols || layer.type !== "symbol")
      .map((layer) => {
        if (layer.id === "roads_shields" && layer.type === "symbol") {
          return {
            ...layer,
            filter: ["all", layer.filter, [">", ["length", ["get", "shield_text"]], 0]],
          };
        }
        if (layer.id !== "pois" || layer.type !== "symbol") return layer;
        return {
          ...layer,
          layout: {
            ...layer.layout,
            "icon-image": [
              "match",
              ["get", "kind"],
              "townhall",
              "building",
              layer.layout?.["icon-image"],
            ],
          },
        };
      }),
    glyphs: glyphsUrl,
    sprite: `${spritesUrl}/${variant}`,
  };
};
