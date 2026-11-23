import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import type { CameraRef } from "@maplibre/maplibre-react-native";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { fitLiveMapMarkers } from "../../lib/fitLiveMapMarkers.ts";
import {
  createLiveMapInitialFitState,
  liveMapInitialFitClosesAtMs,
  reduceLiveMapInitialFit,
} from "../../lib/liveMapInitialFit.ts";
import {
  type LiveMapPinGlide,
  liveMapPinPixelsBetween,
  liveMapPinGlidePosition,
} from "../../lib/liveMapPinGlide.ts";
import {
  buildLiveMapTrackingCameraStop,
  shouldSuspendLiveMapFollowOnRegionChange,
} from "../../lib/liveMapTrackingCamera.ts";
import {
  INITIAL_MAP_CAMERA,
  mapCameraAfterFittingMarkers,
  mapCameraFromRegionChange,
} from "../../lib/mapPmtilesCameraState.ts";
import { subscribeToLiveMapFrames } from "./liveMapFrameTicker.ts";
import { useLiveMapCameraCommands } from "./useLiveMapCameraCommands.ts";
import type { useLiveMapEdgeMarkers } from "./useLiveMapEdgeMarkers.ts";
import type { useNativeMapStyle } from "./useNativeMapStyle.ts";

export const useLiveMapCamera = ({
  awaitingLiveSelfFix,
  bottomOverlayHeight,
  edge,
  locationsLoading,
  mapStyle,
  mapRevision,
  markers,
  onClearSelection,
  onSelectDevice,
  pinGlides,
  pmtilesUrl,
  reduceMotion,
  selectedMarker,
  selectedDeviceId,
  sheetOpen,
  topInset,
  topOverlayBottom,
}: {
  awaitingLiveSelfFix: boolean;
  bottomOverlayHeight: number;
  edge: Pick<
    ReturnType<typeof useLiveMapEdgeMarkers>,
    "follow" | "release" | "releaseAfter" | "suppress"
  >;
  locationsLoading: boolean;
  mapStyle: ReturnType<typeof useNativeMapStyle>["mapStyle"];
  mapRevision: number;
  markers: readonly LiveMapMarker[];
  onClearSelection: () => void;
  onSelectDevice: (deviceId: string) => void;
  pinGlides: ReadonlyMap<string, LiveMapPinGlide>;
  pmtilesUrl: string | null;
  reduceMotion: boolean;
  selectedMarker: LiveMapMarker | null;
  selectedDeviceId: string | null;
  sheetOpen: boolean;
  topInset: number;
  topOverlayBottom: number;
}) => {
  const cameraRef = useRef<CameraRef>(null);
  const cameraAnimationEndsAtMsRef = useRef(0);
  const { scheduleRelease, setCamera } = useLiveMapCameraCommands(
    cameraRef,
    cameraAnimationEndsAtMsRef,
    reduceMotion,
  );
  const scheduleCameraRelease = useEffectEvent(scheduleRelease);
  const moveCamera = useEffectEvent(setCamera);
  const followOnEdge = useEffectEvent(edge.follow);
  const initialFitStateRef = useRef(createLiveMapInitialFitState());
  const initialFitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initialFitRevision, setInitialFitRevision] = useState(0);
  const [styleLoadedRevision, setStyleLoadedRevision] = useState<number | null>(null);
  const isStyleLoaded = styleLoadedRevision === mapRevision;
  const preservedCameraRef = useRef(INITIAL_MAP_CAMERA);
  const pendingCameraRestoreRef = useRef(false);
  const previousPmtilesUrlRef = useRef<string | null>(null);
  const trackedDeviceIdRef = useRef<string | null>(null);
  const trackedCoordinateRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const followSuspendedRef = useRef(false);
  const suppressUserCameraControlUntilMsRef = useRef(0);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const pinGlidesRef = useRef(pinGlides);
  pinGlidesRef.current = pinGlides;
  const shownPosition = (
    pin: { deviceId: string; latitude: number; longitude: number },
    atMs: number,
  ) => {
    const glide = pinGlidesRef.current.get(pin.deviceId);
    return glide ? liveMapPinGlidePosition(glide, atMs) : { ...pin, settled: true };
  };
  const readShownPosition = useEffectEvent(shownPosition);
  const selectedDeviceIdRef = useRef(selectedDeviceId);
  selectedDeviceIdRef.current = selectedDeviceId;
  const sheetOpenRef = useRef(sheetOpen);
  sheetOpenRef.current = sheetOpen;
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
      paddingBottom: selectedDeviceId ? 220 : 48 + bottomOverlayHeight,
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: topInset + 56,
    }),
    [bottomOverlayHeight, topInset, selectedDeviceId],
  );
  const fitEveryonePadding = useMemo(
    () => ({
      paddingBottom: 48 + bottomOverlayHeight,
      paddingLeft: 32,
      paddingRight: MAP_BUTTONS_RIGHT_EDGE + FITTED_PIN_CLEARANCE,
      paddingTop: topOverlayBottom + FITTED_PIN_CLEARANCE,
    }),
    [bottomOverlayHeight, topOverlayBottom],
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
      animate: !reduceMotion,
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
    trackedDeviceIdRef.current = null;
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

    if (selectedDeviceIdRef.current !== currentSelfMarker.deviceId) {
      onSelectDevice(currentSelfMarker.deviceId);
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
      previouslyTrackedDeviceId: null,
      selectedDeviceId: currentSelfMarker.deviceId,
    });
    if (!stop) {
      return;
    }

    edge.follow(currentSelfMarker.deviceId);
    trackedDeviceIdRef.current = currentSelfMarker.deviceId;
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
    trackedDeviceIdRef.current = null;
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

  const fitEdgeGroup = (deviceIds: readonly string[]) => {
    const markersToFit = markersRef.current.filter((item) => deviceIds.includes(item.deviceId));
    if (markersToFit.length === 0) return;
    edge.suppress(deviceIds);
    edge.releaseAfter(600);
    clearLiveMapInitialFitTimer(initialFitTimerRef);
    initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
      type: "user_camera_control",
    }).state;
    trackedDeviceIdRef.current = null;
    trackedCoordinateRef.current = null;
    followSuspendedRef.current = false;
    onClearSelection();
    suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, 600);
    fitMarkersAndPreserveCamera({ markersToFit, padding: fitEveryonePadding });
  };

  const goToDevice = (deviceId: string) => {
    const pin = markersRef.current.find((item) => item.deviceId === deviceId);
    if (!pin) return;
    edge.follow(deviceId);
    if (selectedDeviceIdRef.current !== deviceId) onSelectDevice(deviceId);
    clearLiveMapInitialFitTimer(initialFitTimerRef);
    initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
      type: "user_camera_control",
    }).state;
    followSuspendedRef.current = false;
    const stop = buildLiveMapTrackingCameraStop({
      followSuspended: false,
      latitude: pin.latitude,
      longitude: pin.longitude,
      padding: { ...cameraPaddingRef.current, paddingBottom: 220 },
      previousLatitude: null,
      previousLongitude: null,
      previouslyTrackedDeviceId: null,
      selectedDeviceId: deviceId,
    });
    if (!stop) return;
    const aim = shownPosition(pin, Date.now() + stop.animationDuration);
    trackedDeviceIdRef.current = deviceId;
    trackedCoordinateRef.current = { latitude: aim.latitude, longitude: aim.longitude };
    suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, stop.animationDuration);
    setCamera({ ...stop, centerCoordinate: [aim.longitude, aim.latitude] });
    preservedCameraRef.current = mapCameraFromRegionChange({
      latitude: aim.latitude,
      longitude: aim.longitude,
      zoomLevel: stop.zoomLevel ?? preservedCameraRef.current.zoomLevel,
    });
  };

  const noteUserCameraControl = () => {
    edge.release();
    edge.follow(null);
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
    let backgroundedAtMs: number | null = null;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background") {
        backgroundedAtMs = Date.now();
        return;
      }
      if (nextState !== "active" || backgroundedAtMs === null) return;
      const awayMs = Date.now() - backgroundedAtMs;
      backgroundedAtMs = null;
      const result = reduceLiveMapInitialFit(initialFitStateRef.current, {
        awayMs,
        mapInUse: selectedDeviceIdRef.current !== null || sheetOpenRef.current,
        type: "foreground",
      });
      if (result.state === initialFitStateRef.current) return;
      clearLiveMapInitialFitTimer(initialFitTimerRef);
      initialFitStateRef.current = result.state;
      setInitialFitRevision((revision) => revision + 1);
    });
    return () => {
      subscription.remove();
      clearLiveMapInitialFitTimer(initialFitTimerRef);
    };
  }, []);

  useEffect(() => {
    void initialFitRevision;
    const camera = cameraRef.current;
    if (!mapStyle || !isStyleLoaded || !camera) {
      return;
    }

    const result = reduceLiveMapInitialFit(initialFitStateRef.current, {
      awaitingLiveSelfFix,
      locationsLoading,
      markers,
      nowMs: Date.now(),
      type: "markers",
    });
    initialFitStateRef.current = result.state;
    scheduleLiveMapInitialFitSettle(initialFitTimerRef, initialFitStateRef);

    if (result.fit) {
      suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, 600);
      if (
        fitLiveMapMarkers({ animate: false, camera, markers, padding: fitEveryonePadding }) !== null
      ) {
        scheduleCameraRelease(0);
      }
      preservedCameraRef.current = mapCameraAfterFittingMarkers({
        markers,
        previousCamera: preservedCameraRef.current,
      });
    }
  }, [
    awaitingLiveSelfFix,
    fitEveryonePadding,
    initialFitRevision,
    isStyleLoaded,
    locationsLoading,
    mapStyle,
    markers,
  ]);

  useEffect(() => {
    if (!mapStyle || !cameraRef.current) return;
    if (
      selectedDeviceId === null ||
      selectedLatitude === undefined ||
      selectedLongitude === undefined
    ) {
      trackedDeviceIdRef.current = null;
      trackedCoordinateRef.current = null;
      followSuspendedRef.current = false;
      followOnEdge(null);
      return;
    }

    const selected = {
      deviceId: selectedDeviceId,
      latitude: selectedLatitude,
      longitude: selectedLongitude,
    };
    const shown = readShownPosition(selected, Date.now());
    const isNewFocus = trackedDeviceIdRef.current !== selectedDeviceId;
    const animating = Date.now() < cameraAnimationEndsAtMsRef.current;
    const stop =
      isNewFocus || (shown.settled && !animating)
        ? buildLiveMapTrackingCameraStop({
            followSuspended: followSuspendedRef.current,
            latitude: shown.latitude,
            longitude: shown.longitude,
            padding: cameraPadding,
            previousLatitude: trackedCoordinateRef.current?.latitude ?? null,
            previousLongitude: trackedCoordinateRef.current?.longitude ?? null,
            previouslyTrackedDeviceId: trackedDeviceIdRef.current,
            selectedDeviceId,
          })
        : null;

    if (stop) {
      if (isNewFocus) {
        clearLiveMapInitialFitTimer(initialFitTimerRef);
        initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
          type: "user_camera_control",
        }).state;
      }

      const aim = readShownPosition(selected, Date.now() + stop.animationDuration);
      followSuspendedRef.current = false;
      trackedCoordinateRef.current = { latitude: aim.latitude, longitude: aim.longitude };
      suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, stop.animationDuration);
      moveCamera({ ...stop, centerCoordinate: [aim.longitude, aim.latitude] });
      preservedCameraRef.current = mapCameraFromRegionChange({
        latitude: aim.latitude,
        longitude: aim.longitude,
        zoomLevel: stop.zoomLevel ?? preservedCameraRef.current.zoomLevel,
      });
    }
    trackedDeviceIdRef.current = selectedDeviceId;
    followOnEdge(followSuspendedRef.current ? null : selectedDeviceId);
    if (shown.settled && !animating) return;

    const unsubscribe = subscribeToLiveMapFrames((nowMs) => {
      if (followSuspendedRef.current || trackedDeviceIdRef.current !== selectedDeviceId) {
        unsubscribe();
        return;
      }
      if (nowMs < cameraAnimationEndsAtMsRef.current) return;
      const next = readShownPosition(selected, nowMs);
      const tracked = trackedCoordinateRef.current;
      if (
        !tracked ||
        liveMapPinPixelsBetween(tracked, next, preservedCameraRef.current.zoomLevel) >= 1
      ) {
        trackedCoordinateRef.current = { latitude: next.latitude, longitude: next.longitude };
        moveCamera({
          animationDuration: 0,
          centerCoordinate: [next.longitude, next.latitude],
          padding: cameraPadding,
        });
        preservedCameraRef.current = mapCameraFromRegionChange({
          latitude: next.latitude,
          longitude: next.longitude,
          zoomLevel: preservedCameraRef.current.zoomLevel,
        });
      }
      if (next.settled) unsubscribe();
    });
    return unsubscribe;
  }, [cameraPadding, mapStyle, selectedLatitude, selectedLongitude, selectedDeviceId]);
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
    setStyleLoadedRevision(mapRevision);
    if (!pendingCameraRestoreRef.current) {
      return;
    }

    pendingCameraRestoreRef.current = false;

    if (
      selectedDeviceId !== null &&
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
        previouslyTrackedDeviceId: null,
        selectedDeviceId,
      });
      if (!stop) {
        return;
      }
      setCamera({
        ...stop,
        animationDuration: 0,
      });
      edge.follow(selectedDeviceId);
      trackedDeviceIdRef.current = selectedDeviceId;
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
    goToDevice,
    fitEdgeGroup,
    zoomIntoStack,
    maybeSuspendFollowFromRegionChange,
    onRegionDidChange,
    onStyleLoaded,
  };
};

const MAP_BUTTONS_RIGHT_EDGE = 60;
const FITTED_PIN_CLEARANCE = 28;

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

const scheduleLiveMapInitialFitSettle = (
  timerRef: { current: ReturnType<typeof setTimeout> | null },
  stateRef: { current: ReturnType<typeof createLiveMapInitialFitState> },
) => {
  clearLiveMapInitialFitTimer(timerRef);
  const closesAtMs = liveMapInitialFitClosesAtMs(stateRef.current);
  if (closesAtMs === null) {
    return;
  }

  timerRef.current = setTimeout(
    () => {
      timerRef.current = null;
      stateRef.current = reduceLiveMapInitialFit(stateRef.current, {
        nowMs: Date.now(),
        type: "settle_elapsed",
      }).state;
    },
    Math.max(0, closesAtMs - Date.now()),
  );
};
