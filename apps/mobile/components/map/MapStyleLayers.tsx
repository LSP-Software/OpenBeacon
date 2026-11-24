import { Layer } from "@maplibre/maplibre-react-native";
import { memo } from "react";
import type { getProtomapsThemeLayers } from "../../lib/protomaps-style.ts";

export const MapStyleLayers = memo(
  ({ layers }: { layers: ReturnType<typeof getProtomapsThemeLayers> }) =>
    layers.map((layer) => <Layer key={layer.id} {...layer} />),
);
