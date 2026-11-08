import { layers, namedFlavor } from "@protomaps/basemaps";

export const getProtomapsMapStyle = (
  variant: "light" | "dark",
  pmtilesUrl: string,
  glyphsUrl: string,
  spritesUrl: string,
  showSymbols: boolean,
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
    layers: layers("protomaps", namedFlavor(variant), { lang: "en" }).map((layer) => {
      if (layer.type !== "symbol") return layer;
      const symbolLayer = {
        ...layer,
        layout: { ...layer.layout, visibility: getSymbolVisibility(showSymbols) },
      };
      if (layer.id === "roads_shields") {
        return {
          ...symbolLayer,
          filter: ["all", layer.filter, [">", ["length", ["get", "shield_text"]], 0]],
        };
      }
      if (layer.id !== "pois") return symbolLayer;
      return {
        ...symbolLayer,
        layout: {
          ...symbolLayer.layout,
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

export const getSymbolLayerIds = (style: { layers: readonly { id: string; type: string }[] }) =>
  style.layers.filter((layer) => layer.type === "symbol").map((layer) => layer.id);

export const getSymbolVisibility = (showSymbols: boolean) =>
  showSymbols ? ("visible" as const) : ("none" as const);
