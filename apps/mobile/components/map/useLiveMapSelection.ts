import { useRef, useState } from "react";
import { Platform } from "react-native";

export const useLiveMapSelection = ({
  selectedDeviceId,
  onSelectDeviceId,
  isMarkerReplaced,
}: {
  selectedDeviceId: string | null;
  onSelectDeviceId: ((deviceId: string | null) => void) | undefined;
  isMarkerReplaced: (deviceId: string) => boolean;
}) => {
  const selectedDeviceIdRef = useRef(selectedDeviceId);
  selectedDeviceIdRef.current = selectedDeviceId;
  const pendingDeselectClearRef = useRef(false);
  const [annotationRemountTokens, setAnnotationRemountTokens] = useState<Record<string, number>>(
    {},
  );

  const clearSelectionFromReact = () => {
    pendingDeselectClearRef.current = false;
    const previouslySelectedDeviceId = selectedDeviceIdRef.current;
    if (Platform.OS !== "android" && previouslySelectedDeviceId !== null) {
      setAnnotationRemountTokens((tokens) => ({
        ...tokens,
        [previouslySelectedDeviceId]: (tokens[previouslySelectedDeviceId] ?? 0) + 1,
      }));
    }
    onSelectDeviceId?.(null);
  };
  const handleAnnotationDeselected = (deviceId: string) => {
    if (isMarkerReplaced(deviceId)) return;
    pendingDeselectClearRef.current = true;
    queueMicrotask(() => {
      if (!pendingDeselectClearRef.current) {
        return;
      }
      pendingDeselectClearRef.current = false;
      if (!isMarkerReplaced(deviceId)) onSelectDeviceId?.(null);
    });
  };
  const handleAnnotationSelected = (deviceId: string) => {
    pendingDeselectClearRef.current = false;
    onSelectDeviceId?.(deviceId);
  };

  return {
    annotationRemountTokens,
    clearSelectionFromReact,
    handleAnnotationDeselected,
    handleAnnotationSelected,
  };
};
