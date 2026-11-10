import { useEffect, useMemo, useRef } from "react";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { fitLiveMapMarkers } from "../../lib/fitLiveMapMarkers.ts";
import {
  createLiveMapInitialFitState,
  LIVE_MAP_INITIAL_FIT_COALESCE_MS,
  reduceLiveMapInitialFit,
} from "../../lib/liveMapInitialFit.ts";
import {
  buildLiveMapTrackingCameraStop,
  shouldSuspendLiveMapFollowOnRegionChange,
} from "../../lib/liveMapTrackingCamera.ts";
import {
  INITIAL_MAP_CAMERA,
  mapCameraAfterFittingMarkers,
  mapCameraFromRegionChange,
} from "../../lib/mapPmtilesCameraState.ts";
import { useLiveMapCameraCommands } from "./useLiveMapCameraCommands.ts";
import type { useLiveMapEdgeMarkers } from "./useLiveMapEdgeMarkers.ts";
import type { useNativeMapStyle } from "./useNativeMapStyle.ts";

export const useLiveMapCamera = ({
  bottomOverlayHeight,
  edge,
  mapStyle,
  mapRevision,
  markers,
  onClearSelection,
  onSelectUser,
  pmtilesUrl,
  selectedMarker,
  selectedUserId,
  topInset,
}: {
  bottomOverlayHeight: number;
  edge: Pick<ReturnType<typeof useLiveMapEdgeMarkers>, "suppress" | "release" | "releaseAfter">;
  mapStyle: ReturnType<typeof useNativeMapStyle>["mapStyle"];
  mapRevision: number;
  markers: readonly LiveMapMarker[];
  onClearSelection: () => void;
  onSelectUser: (userId: string) => void;
  pmtilesUrl: string | null;
  selectedMarker: LiveMapMarker | null;
  selectedUserId: string | null;
  topInset: number;
}) => {
  const { cameraRef, scheduleRelease, setCamera } = useLiveMapCameraCommands();
  const initialFitStateRef = useRef(createLiveMapInitialFitState());
  const initialFitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preservedCameraRef = useRef(INITIAL_MAP_CAMERA);
  const pendingCameraRestoreRef = useRef(false);
  const previousPmtilesUrlRef = useRef<string | null>(null);
  const trackedUserIdRef = useRef<string | null>(null);
  const trackedCoordinateRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const followSuspendedRef = useRef(false);
  const suppressUserCameraControlUntilMsRef = useRef(0);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const selectedUserIdRef = useRef(selectedUserId);
  selectedUserIdRef.current = selectedUserId;
  if (previousPmtilesUrlRef.current !== pmtilesUrl) {
    if (previousPmtilesUrlRef.current !== null && pmtilesUrl !== null) {
      pendingCameraRestoreRef.current = true;
    }
    previousPmtilesUrlRef.current = pmtilesUrl;
  }
  const selectedLatitude = selectedMarker?.latitude;
  const selectedLongitude = selectedMarker?.longitude;
  const cameraPadding = useMemo(
    () => ({
      paddingBottom: selectedUserId ? 220 : 48 + bottomOverlayHeight,
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: topInset + 56,
    }),
    [bottomOverlayHeight, topInset, selectedUserId],
  );
  const fitEveryonePadding = useMemo(
    () => ({
      paddingBottom: 48 + bottomOverlayHeight,
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: topInset + 56,
    }),
    [bottomOverlayHeight, topInset],
  );
  const cameraPaddingRef = useRef(cameraPadding);
  cameraPaddingRef.current = cameraPadding;

  const cameraDefaultSettings = useMemo(() => {
    void pmtilesUrl;
    void mapRevision;
    return {
      centerCoordinate: [...preservedCameraRef.current.centerCoordinate] as [number, number],
      zoomLevel: preservedCameraRef.current.zoomLevel,
    };
  }, [pmtilesUrl, mapRevision]);

  const fitMarkersAndPreserveCamera = ({
    markersToFit,
    padding,
  }: {
    markersToFit: readonly LiveMapMarker[];
    padding: {
      paddingBottom: number;
      paddingLeft: number;
      paddingRight: number;
      paddingTop: number;
    };
  }) => {
    const animationDuration = fitLiveMapMarkers({
      camera: cameraRef.current,
      markers: markersToFit,
      padding,
    });
    if (animationDuration !== null) {
      scheduleRelease(animationDuration);
    }
    preservedCameraRef.current = mapCameraAfterFittingMarkers({
      markers: markersToFit,
      previousCamera: preservedCameraRef.current,
    });
  };

  const fitEveryoneInFrame = () => {
    clearLiveMapInitialFitTimer(initialFitTimerRef);
    initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
      type: "show_everyone",
    }).state;
    trackedUserIdRef.current = null;
    trackedCoordinateRef.current = null;
    followSuspendedRef.current = false;
    onClearSelection();
    suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, 600);
    fitMarkersAndPreserveCamera({
      markersToFit: markersRef.current,
      padding: fitEveryonePadding,
    });
  };

  const goToCurrentLocation = () => {
    const currentSelfMarker = markersRef.current.find((marker) => marker.isSelf);
    if (!currentSelfMarker) {
      return;
    }

    clearLiveMapInitialFitTimer(initialFitTimerRef);
    initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
      type: "user_camera_control",
    }).state;

    followSuspendedRef.current = false;

    if (selectedUserIdRef.current !== currentSelfMarker.userId) {
      onSelectUser(currentSelfMarker.userId);
    }

    const stop = buildLiveMapTrackingCameraStop({
      followSuspended: false,
      latitude: currentSelfMarker.latitude,
      longitude: currentSelfMarker.longitude,
      padding: {
        paddingBottom: 220,
        paddingLeft: cameraPaddingRef.current.paddingLeft,
        paddingRight: cameraPaddingRef.current.paddingRight,
        paddingTop: cameraPaddingRef.current.paddingTop,
      },
      previousLatitude: null,
      previousLongitude: null,
      previouslyTrackedUserId: null,
      selectedUserId: currentSelfMarker.userId,
    });
    if (!stop) {
      return;
    }

    trackedUserIdRef.current = currentSelfMarker.userId;
    trackedCoordinateRef.current = {
      latitude: currentSelfMarker.latitude,
      longitude: currentSelfMarker.longitude,
    };
    suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, stop.animationDuration);
    setCamera(stop);
    preservedCameraRef.current = mapCameraFromRegionChange({
      latitude: currentSelfMarker.latitude,
      longitude: currentSelfMarker.longitude,
      zoomLevel: stop.zoomLevel ?? preservedCameraRef.current.zoomLevel,
    });
  };

  const zoomIntoStack = ({
    latitude,
    longitude,
    zoomLevel,
  }: {
    latitude: number;
    longitude: number;
    zoomLevel: number;
  }) => {
    clearLiveMapInitialFitTimer(initialFitTimerRef);
    initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
      type: "user_camera_control",
    }).state;
    trackedUserIdRef.current = null;
    trackedCoordinateRef.current = null;
    followSuspendedRef.current = false;
    onClearSelection();
    suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, 600);
    setCamera({
      animationDuration: 600,
      animationMode: "easeTo",
      centerCoordinate: [longitude, latitude],
      padding: fitEveryonePadding,
      zoomLevel,
    });
  };

  const fitEdgeGroup = (userIds: readonly string[]) => {
    const markersToFit = markersRef.current.filter((item) => userIds.includes(item.userId));
    if (markersToFit.length === 0) return;
    edge.suppress(userIds);
    edge.releaseAfter(600);
    clearLiveMapInitialFitTimer(initialFitTimerRef);
    initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
      type: "user_camera_control",
    }).state;
    trackedUserIdRef.current = null;
    trackedCoordinateRef.current = null;
    followSuspendedRef.current = false;
    onClearSelection();
    suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, 600);
    fitMarkersAndPreserveCamera({ markersToFit, padding: fitEveryonePadding });
  };

  const goToEdgeMarker = (userId: string) => {
    const marker = markersRef.current.find((item) => item.userId === userId);
    if (!marker) return;
    edge.suppress([userId]);
    if (selectedUserIdRef.current !== userId) onSelectUser(userId);
    clearLiveMapInitialFitTimer(initialFitTimerRef);
    initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
      type: "user_camera_control",
    }).state;
    followSuspendedRef.current = false;
    const stop = buildLiveMapTrackingCameraStop({
      followSuspended: false,
      latitude: marker.latitude,
      longitude: marker.longitude,
      padding: { ...cameraPaddingRef.current, paddingBottom: 220 },
      previousLatitude: null,
      previousLongitude: null,
      previouslyTrackedUserId: null,
      selectedUserId: userId,
    });
    if (!stop) {
      edge.release();
      return;
    }
    edge.releaseAfter(stop.animationDuration);
    trackedUserIdRef.current = userId;
    trackedCoordinateRef.current = { latitude: marker.latitude, longitude: marker.longitude };
    suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, stop.animationDuration);
    setCamera(stop);
  };

  const noteUserCameraControl = () => {
    edge.release();
    clearLiveMapInitialFitTimer(initialFitTimerRef);
    initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
      type: "user_camera_control",
    }).state;
    followSuspendedRef.current = true;
  };

  const maybeSuspendFollowFromRegionChange = (feature: {
    properties: {
      animated: boolean;
      isUserInteraction: boolean;
    };
  }) => {
    if (
      !shouldSuspendLiveMapFollowOnRegionChange({
        animated: feature.properties.animated,
        isUserInteraction: feature.properties.isUserInteraction,
        nowMs: Date.now(),
        suppressUserCameraControlUntilMs: suppressUserCameraControlUntilMsRef.current,
      })
    ) {
      return;
    }
    noteUserCameraControl();
  };

  useEffect(() => {
    return () => {
      clearLiveMapInitialFitTimer(initialFitTimerRef);
    };
  }, []);

  useEffect(() => {
    if (!mapStyle || !cameraRef.current) {
      return;
    }

    const result = reduceLiveMapInitialFit(initialFitStateRef.current, {
      nowMs: Date.now(),
      type: "markers",
      userIds: markers.map((marker) => marker.userId),
    });
    initialFitStateRef.current = result.state;

    if (result.shouldFit) {
      suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, 600);
      const animationDuration = fitLiveMapMarkers({
        camera: cameraRef.current,
        markers,
        padding: cameraPadding,
      });
      if (animationDuration !== null) {
        scheduleRelease(animationDuration);
      }
      preservedCameraRef.current = mapCameraAfterFittingMarkers({
        markers,
        previousCamera: preservedCameraRef.current,
      });
      scheduleLiveMapInitialFitClose(initialFitTimerRef, initialFitStateRef);
    }
  }, [cameraPadding, mapStyle, markers]);

  useEffect(() => {
    if (!mapStyle || !cameraRef.current) return;
    if (
      selectedUserId === null ||
      selectedLatitude === undefined ||
      selectedLongitude === undefined
    ) {
      trackedUserIdRef.current = null;
      trackedCoordinateRef.current = null;
      followSuspendedRef.current = false;
      return;
    }

    const stop = buildLiveMapTrackingCameraStop({
      followSuspended: followSuspendedRef.current,
      latitude: selectedLatitude,
      longitude: selectedLongitude,
      padding: cameraPadding,
      previousLatitude: trackedCoordinateRef.current?.latitude ?? null,
      previousLongitude: trackedCoordinateRef.current?.longitude ?? null,
      previouslyTrackedUserId: trackedUserIdRef.current,
      selectedUserId,
    });

    if (!stop) {
      trackedUserIdRef.current = selectedUserId;
      return;
    }

    if (trackedUserIdRef.current !== selectedUserId) {
      clearLiveMapInitialFitTimer(initialFitTimerRef);
      initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
        type: "user_camera_control",
      }).state;
    }

    followSuspendedRef.current = false;
    trackedUserIdRef.current = selectedUserId;
    trackedCoordinateRef.current = {
      latitude: selectedLatitude,
      longitude: selectedLongitude,
    };
    suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, stop.animationDuration);
    setCamera(stop);
    preservedCameraRef.current = mapCameraFromRegionChange({
      latitude: selectedLatitude,
      longitude: selectedLongitude,
      zoomLevel: stop.zoomLevel ?? preservedCameraRef.current.zoomLevel,
    });
  }, [cameraPadding, mapStyle, selectedLatitude, selectedLongitude, selectedUserId]);
  const onRegionDidChange = (feature: {
    geometry: { coordinates: number[] };
    properties: { animated: boolean; isUserInteraction: boolean; zoomLevel: number };
  }) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    if (longitude !== undefined && latitude !== undefined) {
      preservedCameraRef.current = mapCameraFromRegionChange({
        latitude,
        longitude,
        zoomLevel: feature.properties.zoomLevel,
      });
    }
    maybeSuspendFollowFromRegionChange(feature);
  };

  const onStyleLoaded = () => {
    if (!pendingCameraRestoreRef.current) {
      return;
    }

    pendingCameraRestoreRef.current = false;

    if (
      selectedUserId !== null &&
      selectedLatitude !== undefined &&
      selectedLongitude !== undefined
    ) {
      const stop = buildLiveMapTrackingCameraStop({
        followSuspended: false,
        latitude: selectedLatitude,
        longitude: selectedLongitude,
        padding: cameraPadding,
        previousLatitude: null,
        previousLongitude: null,
        previouslyTrackedUserId: null,
        selectedUserId,
      });
      if (!stop) {
        return;
      }
      setCamera({
        ...stop,
        animationDuration: 0,
      });
      trackedUserIdRef.current = selectedUserId;
      trackedCoordinateRef.current = {
        latitude: selectedLatitude,
        longitude: selectedLongitude,
      };
      followSuspendedRef.current = false;
      preservedCameraRef.current = mapCameraFromRegionChange({
        latitude: selectedLatitude,
        longitude: selectedLongitude,
        zoomLevel: stop.zoomLevel ?? preservedCameraRef.current.zoomLevel,
      });
      return;
    }

    setCamera({
      animationDuration: 0,
      centerCoordinate: preservedCameraRef.current.centerCoordinate,
      zoomLevel: preservedCameraRef.current.zoomLevel,
    });
  };

  return {
    cameraRef,
    cameraDefaultSettings,
    cameraPadding,
    fitEveryoneInFrame,
    goToCurrentLocation,
    goToEdgeMarker,
    fitEdgeGroup,
    zoomIntoStack,
    maybeSuspendFollowFromRegionChange,
    onRegionDidChange,
    onStyleLoaded,
  };
};

const clearLiveMapInitialFitTimer = (timerRef: {
  current: ReturnType<typeof setTimeout> | null;
}) => {
  if (timerRef.current === null) {
    return;
  }
  clearTimeout(timerRef.current);
  timerRef.current = null;
};

const suppressUserCameraControlFor = (
  untilMsRef: { current: number },
  animationDurationMs: number,
) => {
  untilMsRef.current = Math.max(untilMsRef.current, Date.now() + animationDurationMs + 100);
};

const scheduleLiveMapInitialFitClose = (
  timerRef: { current: ReturnType<typeof setTimeout> | null },
  stateRef: { current: ReturnType<typeof createLiveMapInitialFitState> },
) => {
  clearLiveMapInitialFitTimer(timerRef);
  const coalesceStartedAtMs = stateRef.current.coalesceStartedAtMs;
  if (stateRef.current.phase !== "coalescing" || coalesceStartedAtMs === null) {
    return;
  }

  const remainingMs = coalesceStartedAtMs + LIVE_MAP_INITIAL_FIT_COALESCE_MS - Date.now();
  timerRef.current = setTimeout(
    () => {
      timerRef.current = null;
      stateRef.current = reduceLiveMapInitialFit(stateRef.current, {
        nowMs: Date.now(),
        type: "coalesce_elapsed",
      }).state;
    },
    Math.max(0, remainingMs),
  );
};
