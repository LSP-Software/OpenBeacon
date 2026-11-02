import { useRef, useState } from "react";
import { Platform } from "react-native";

export const useLiveMapSelection = ({
  selectedUserId,
  onSelectUserId,
  isEdgeMarker,
}: {
  selectedUserId: string | null;
  onSelectUserId: ((userId: string | null) => void) | undefined;
  isEdgeMarker: (userId: string) => boolean;
}) => {
  const selectedUserIdRef = useRef(selectedUserId);
  selectedUserIdRef.current = selectedUserId;
  const pendingDeselectClearRef = useRef(false);
  const [annotationRemountTokens, setAnnotationRemountTokens] = useState<Record<string, number>>(
    {},
  );

  const clearSelectionFromReact = () => {
    pendingDeselectClearRef.current = false;
    const previouslySelectedUserId = selectedUserIdRef.current;
    if (Platform.OS !== "android" && previouslySelectedUserId !== null) {
      setAnnotationRemountTokens((tokens) => ({
        ...tokens,
        [previouslySelectedUserId]: (tokens[previouslySelectedUserId] ?? 0) + 1,
      }));
    }
    onSelectUserId?.(null);
  };
  const handleAnnotationDeselected = (userId: string) => {
    if (isEdgeMarker(userId)) return;
    pendingDeselectClearRef.current = true;
    queueMicrotask(() => {
      if (!pendingDeselectClearRef.current) {
        return;
      }
      pendingDeselectClearRef.current = false;
      if (!isEdgeMarker(userId)) onSelectUserId?.(null);
    });
  };
  const handleAnnotationSelected = (userId: string) => {
    pendingDeselectClearRef.current = false;
    onSelectUserId?.(userId);
  };

  return {
    annotationRemountTokens,
    clearSelectionFromReact,
    handleAnnotationDeselected,
    handleAnnotationSelected,
  };
};
