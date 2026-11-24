import { useCallback, useEffect } from "react";
import { useAnimatedProps, useFrameCallback, useSharedValue } from "react-native-reanimated";
import {
  type LiveMapPinGlide,
  liveMapPinGlideOffsetPosition,
  liveMapPinPixelsBetween,
} from "../../lib/liveMapPinGlide.ts";

export const useLiveMapPinPosition = ({
  base,
  deviceIds,
  getZoom,
  glides,
}: {
  base: { latitude: number; longitude: number };
  deviceIds: readonly string[];
  getZoom: () => number;
  glides: ReadonlyMap<string, LiveMapPinGlide>;
}) => {
  const pinGlides = deviceIds.flatMap((deviceId) => glides.get(deviceId) ?? []);
  const shown = liveMapPinGlideOffsetPosition({ base, glides: pinGlides, nowMs: Date.now() });
  const lngLat: [number, number] = [shown.longitude, shown.latitude];
  const position = useSharedValue(lngLat);
  const gliding = useSharedValue<{
    base: { latitude: number; longitude: number };
    glides: LiveMapPinGlide[];
    zoom: number;
  } | null>(null);
  const frame = useFrameCallback(
    useCallback(() => {
      "worklet";
      const current = gliding.value;
      if (!current) return;
      const shown = liveMapPinGlideOffsetPosition({ ...current, nowMs: Date.now() });
      const [longitude, latitude] = position.value;
      if (liveMapPinPixelsBetween({ latitude, longitude }, shown, current.zoom) < 0.5) return;
      position.value = [shown.longitude, shown.latitude];
    }, [gliding, position]),
    false,
  );
  const pinKey = `${deviceIds.join(",")}:${base.latitude}:${base.longitude}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the glides map and pin key say when the drawn path changes; base and pinGlides are rebuilt each render
  useEffect(() => {
    const settle = () => {
      frame.setActive(false);
      gliding.value = null;
      const shown = liveMapPinGlideOffsetPosition({ base, glides: pinGlides, nowMs: Date.now() });
      position.value = [shown.longitude, shown.latitude];
    };
    const endsAtMs = Math.max(0, ...pinGlides.map((glide) => glide.startedAtMs + glide.durationMs));
    if (endsAtMs <= Date.now()) {
      settle();
      return;
    }
    gliding.value = {
      base: { latitude: base.latitude, longitude: base.longitude },
      glides: pinGlides,
      zoom: getZoom(),
    };
    frame.setActive(true);
    const timer = setTimeout(settle, endsAtMs - Date.now());
    return () => clearTimeout(timer);
  }, [glides, pinKey]);

  const animatedProps = useAnimatedProps(() => ({ lngLat: position.value }));

  return { animatedProps, lngLat };
};
