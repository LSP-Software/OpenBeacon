import type { ViewAnnotationRef } from "@maplibre/maplibre-react-native";
import type { RefObject } from "react";

export const refreshViewAnnotation = (annotationRef: RefObject<ViewAnnotationRef | null>) => {
  // Fabric runs a view command before it mounts the props committed with it, so a refresh straight away redraws the old look
  requestAnimationFrame(() => requestAnimationFrame(() => annotationRef.current?.refresh()));
};
