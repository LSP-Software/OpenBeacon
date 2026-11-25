import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from "@maplibre/maplibre-react-native";
import { useIsFocused } from "@react-navigation/native";
import { Link } from "expo-router";
import {
  ChevronDownIcon,
  EyeOffIcon,
  HistoryIcon,
  LayersIcon,
  LocateFixedIcon,
  ScanIcon,
  UsersIcon,
} from "lucide-react-native";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, BackHandler, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLiveSpeedLabel } from "../../hooks/useLiveSpeedLabel.ts";
import { useReducedMotion } from "../../hooks/useReducedMotion.ts";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import {
  type LiveMapPinGroup,
  type LiveMapPinOffset,
  liveMapStackExpansionZoom,
  mergeSamePersonDevices,
} from "../../lib/liveMapPinGroups.ts";
import { cn } from "../../lib/cn.ts";
import type { MapGroupOption, MapMemberDevice, MapPeople } from "../../lib/mapPeopleTypes.ts";
import {
  type MapPlace,
  metersBetween,
  peopleAtPlace,
  placeCirclePolygon,
  zoomToFitPlace,
} from "../../lib/places.ts";
import { useColors } from "../../lib/theme.ts";
import { Icon } from "../ui/Icon.tsx";
import { Button } from "../ui/Button.tsx";
import { Text } from "../ui/Text.tsx";
import { LiveMapEdgeChip } from "./LiveMapEdgeChip.tsx";
import { MapButtonGroup, MapChip, MapIconButton } from "./MapControls.tsx";
import { MapStyleLayers } from "./MapStyleLayers.tsx";
import { MapBottomInset, MapSurface } from "./MapSurface.tsx";
import { LiveMapGroupMenu, LiveMapHiddenGroupsNotice } from "./LiveMapGroupVisibility.tsx";
import { LiveMapMissingPersonSheet } from "./LiveMapMissingPersonSheet.tsx";
import { LiveMapPeopleTray } from "./LiveMapPeopleTray.tsx";
import { LiveMapPointAnnotation, SelfLiveMapPointAnnotation } from "./LiveMapPointAnnotation.tsx";
import { LiveMapSpeedChipAnnotation } from "./LiveMapSpeedChipAnnotation.tsx";
import { LiveMapPersonSheet } from "./LiveMapPersonSheet.tsx";
import { LiveMapPlaceSheet } from "./LiveMapPlaceSheet.tsx";
import { PlaceAnnotation } from "./PlaceAnnotation.tsx";
import { CrashSpotAnnotation } from "./CrashSpotAnnotation.tsx";
import { LiveMapStackAnnotation } from "./LiveMapStackAnnotation.tsx";
import { LiveMapStackSheet } from "./LiveMapStackSheet.tsx";
import { useLiveMapEdgeMarkers } from "./useLiveMapEdgeMarkers.ts";
import { useLiveMapCamera } from "./useLiveMapCamera.ts";
import { useLiveMapPinGroups } from "./useLiveMapPinGroups.ts";
import { useLiveMapPinGlides } from "./useLiveMapPinGlides.ts";
import { useNativeMapStyle } from "./useNativeMapStyle.ts";
import { type CrashIncident, crashFocusSpot } from "../../lib/crashAlertInbox.ts";

export const NativeMap = ({
  awaitingLiveSelfFix = false,
  bottomInset = 0,
  crash = null,
  devices = [],
  focusCrashUserId = null,
  focusPlaceId = null,
  groupOptions = null,
  locationsLoading = false,
  markers = [],
  now = 0,
  onFocusCrashHandled,
  onFocusPlaceHandled,
  onPeopleTrayOpenChange,
  onDeletePlace,
  onRequestUpdate,
  onSetGroupHidden,
  onSelectDeviceId,
  people = null,
  peopleTrayOpen = false,
  places = [],
  selectedDeviceId = null,
  timelineGroupId = null,
}: {
  awaitingLiveSelfFix?: boolean;
  bottomInset?: number;
  crash?: CrashIncident | null;
  devices?: readonly (MapMemberDevice & { paused: boolean; unreadable: boolean })[];
  focusCrashUserId?: string | null;
  focusPlaceId?: string | null;
  groupOptions?: readonly MapGroupOption[] | null;
  locationsLoading?: boolean;
  markers?: readonly LiveMapMarker[];
  now?: number;
  onFocusCrashHandled?: () => void;
  onFocusPlaceHandled?: () => void;
  onPeopleTrayOpenChange?: (open: boolean) => void;
  onDeletePlace?: (place: MapPlace, onDeleted: () => void) => void;
  onRequestUpdate?: ((userId: string) => Promise<void>) | undefined;
  onSetGroupHidden?: (groupId: string, hidden: boolean) => void;
  onSelectDeviceId?: (deviceId: string | null) => void;
  people?: MapPeople | null;
  peopleTrayOpen?: boolean;
  places?: readonly MapPlace[];
  selectedDeviceId?: string | null;
  timelineGroupId?: string | null;
} = {}) => {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const reduceMotion = useReducedMotion();
  const colors = useColors();
  const [selectedPlaceKey, setSelectedPlaceKey] = useState<string | null>(null);
  const selectedPlace = places.find((place) => placeKey(place) === selectedPlaceKey) ?? null;
  const handledFocusPlaceIdRef = useRef<string | null>(null);
  const map = useNativeMapStyle();
  const { mapStyle, pmtilesUrl, showSymbols } = map;
  const mapStyleJson = useMemo(() => JSON.stringify(mapStyle), [mapStyle]);
  const selectedMarker = markers.find((marker) => marker.deviceId === selectedDeviceId) ?? null;
  const selectedSpeedLabel = useLiveSpeedLabel({
    speed: selectedMarker?.speed ?? null,
    timestamp: selectedMarker?.timestamp ?? null,
  });
  const pinMarkers = useMemo(() => mergeSamePersonDevices(markers), [markers]);
  const pins = useLiveMapPinGroups(pinMarkers);
  const pinGlides = useLiveMapPinGlides(markers, reduceMotion || !isFocused);
  const selectedGlide = selectedDeviceId === null ? undefined : pinGlides.get(selectedDeviceId);
  const selectedLiveUntilMs =
    selectedGlide && selectedGlide.durationMs > 0
      ? selectedGlide.startedAtMs + selectedGlide.durationMs
      : undefined;
  const edgeSubjects = useMemo(
    () =>
      pins.groups.map((group) => ({
        latitude: group.latitude,
        longitude: group.longitude,
        memberDeviceIds: group.members.map((member) => member.deviceId),
        userId: group.id,
      })),
    [pins.groups],
  );
  const pinPressAtRef = useRef(0);
  const [stackSheetDeviceIds, setStackSheetDeviceIds] = useState<readonly string[] | null>(null);
  const stackSheetMembers = (stackSheetDeviceIds ?? []).flatMap((deviceId) =>
    pinMarkers.filter((marker) => marker.deviceId === deviceId),
  );
  const selectedPersonDevices = selectedMarker
    ? devices
        .filter((device) => device.userId === selectedMarker.userId)
        .map((device) => ({
          ...device,
          marker: markers.find((marker) => marker.deviceId === device.deviceId) ?? null,
        }))
    : [];
  const isStackSheetOpen = stackSheetMembers.length > 1;
  const [missingUserId, setMissingUserId] = useState<string | null>(null);
  const missingPerson =
    [
      ...(people?.paused ?? []),
      ...(people?.waitingForLocation ?? []),
      ...(people?.cantLocate ?? []),
      ...(people?.cantRead ?? []),
      ...(people?.hidden ?? []),
    ].find((person) => person.userId === missingUserId) ?? null;
  const missingPersonDevices = devices.filter((device) => device.userId === missingUserId);
  const isTrayOpen =
    peopleTrayOpen &&
    selectedMarker === null &&
    selectedPlace === null &&
    !isStackSheetOpen &&
    missingUserId === null;
  const trayPeople = isTrayOpen ? people : null;
  const [trayHeight, setTrayHeight] = useState(0);
  const [mapHeight, setMapHeight] = useState(0);
  const [chipsBottom, setChipsBottom] = useState<number | null>(null);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [toastGroups, setToastGroups] = useState<readonly { id: string; name: string }[]>([]);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const canHideGroups = groupOptions !== null && groupOptions.length > 1;
  const hiddenGroupCount = groupOptions?.filter((group) => group.hidden).length ?? 0;
  const setGroupHidden = (groupId: string, hidden: boolean) => {
    onSetGroupHidden?.(groupId, hidden);
    const group = groupOptions?.find((item) => item.id === groupId);
    if (!hidden || !group) {
      setToastGroups((current) => current.filter((item) => item.id !== groupId));
      return;
    }
    AccessibilityInfo.announceForAccessibility(
      `${group.name} hidden. You’re still sharing your location with them.`,
    );
    setToastGroups((current) => [
      ...current.filter((item) => item.id !== groupId),
      { id: groupId, name: group.name },
    ]);
  };
  const unreadableMarkerCount = markers.filter(
    (marker) => marker.unreadableGroup !== undefined,
  ).length;
  const hasKeyProblem = (people?.cantRead.length ?? 0) + unreadableMarkerCount > 0;
  const needsAttentionCount =
    (people?.cantLocate.length ?? 0) + (people?.cantRead.length ?? 0) + unreadableMarkerCount;
  const showAttentionCount =
    people !== null && people.finding.length === 0 && needsAttentionCount > 0;
  useEffect(() => {
    if (stackSheetDeviceIds === null) return;
    const stillTogether =
      selectedDeviceId === null &&
      pins.groups.some((group) =>
        stackSheetDeviceIds.every((deviceId) =>
          group.members.some((member) => member.deviceId === deviceId),
        ),
      );
    if (!stillTogether) setStackSheetDeviceIds(null);
  }, [pins.groups, selectedDeviceId, stackSheetDeviceIds]);
  const edge = useLiveMapEdgeMarkers({
    markers: edgeSubjects,
    mapRevision: map.mapRevision,
    sheetKey:
      (selectedPlace ? `place:${placeKey(selectedPlace)}` : null) ??
      selectedMarker?.userId ??
      (isStackSheetOpen
        ? "stack"
        : missingPerson
          ? `missing:${missingPerson.userId}`
          : trayPeople
            ? "tray"
            : null),
    topInset: insets.top + 48,
  });
  const { edgeMarkers, mapRef } = edge;
  const clearSelection = () => onSelectDeviceId?.(null);
  const selectDevice = (deviceId: string) => onSelectDeviceId?.(deviceId);
  const closeSheets = () => {
    setSelectedPlaceKey(null);
    setStackSheetDeviceIds(null);
    setMissingUserId(null);
    setGroupMenuOpen(false);
    clearSelection();
  };
  const openGroupMenu = () => {
    closeSheets();
    setGroupMenuOpen(true);
  };
  const selfMarker = markers.find((marker) => marker.isSelf) ?? null;
  const personTimelineGroupId = selectedMarker?.sourceGroupId || timelineGroupId;
  const hasMarkers = markers.length > 0;
  const camera = useLiveMapCamera({
    awaitingLiveSelfFix,
    bottomOverlayHeight: trayPeople ? trayHeight : bottomInset,
    edge,
    locationsLoading,
    mapStyle,
    mapRevision: map.mapRevision,
    markers,
    onClearSelection: closeSheets,
    onSelectDevice: selectDevice,
    pinGlides,
    pmtilesUrl,
    reduceMotion,
    selectedMarker,
    selectedDeviceId,
    sheetOpen:
      selectedPlace !== null || isStackSheetOpen || missingUserId !== null || focusPlaceId !== null,
    topInset: insets.top,
    topOverlayBottom: chipsBottom ?? insets.top + 48,
  });
  const {
    cameraRef,
    cameraDefaultSettings,
    fitEdgeGroup,
    fitEveryoneInFrame,
    goToCurrentLocation,
    goToDevice,
    maybeSuspendFollowFromRegionChange,
    zoomIntoStack,
  } = camera;
  const closeTopLayer =
    canHideGroups && groupMenuOpen
      ? () => setGroupMenuOpen(false)
      : selectedPlace
        ? () => setSelectedPlaceKey(null)
        : selectedMarker
          ? clearSelection
          : isStackSheetOpen
            ? () => setStackSheetDeviceIds(null)
            : missingPerson
              ? () => setMissingUserId(null)
              : trayPeople
                ? () => onPeopleTrayOpenChange?.(false)
                : null;
  const closeTopLayerRef = useRef(closeTopLayer);
  closeTopLayerRef.current = closeTopLayer;
  const canCloseTopLayer = isFocused && closeTopLayer !== null;
  const displayOrder = (members: readonly LiveMapMarker[]) =>
    [...members].sort(
      (first, second) =>
        Number(second.deviceId === selectedDeviceId) -
          Number(first.deviceId === selectedDeviceId) ||
        Number(first.isSelf) - Number(second.isSelf) ||
        first.name.localeCompare(second.name),
    );

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReaderEnabled);
    const subscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setScreenReaderEnabled,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (toastGroups.length === 0 || screenReaderEnabled) return;
    const timer = setTimeout(() => setToastGroups([]), 5_000);
    return () => clearTimeout(timer);
  }, [screenReaderEnabled, toastGroups]);

  useEffect(() => {
    if (!canCloseTopLayer) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      closeTopLayerRef.current?.();
      return true;
    });
    return () => subscription.remove();
  }, [canCloseTopLayer]);

  useEffect(() => {
    if (missingUserId === null) return;
    const hasMarker = markers.some((marker) => marker.userId === missingUserId);
    if (!hasMarker && missingPerson !== null) return;
    setMissingUserId(null);
    const pinDeviceId = personPinDeviceId({ markers, people, pinMarkers, userId: missingUserId });
    if (pinDeviceId) goToDevice(pinDeviceId);
  }, [goToDevice, markers, missingPerson, missingUserId, people, pinMarkers]);

  const crashFocusDeviceIdRef = useRef<string | null>(null);
  const personSheetHeightRef = useRef<number | null>(null);

  const focusCrashAbovePersonSheet = useEffectEvent(() => {
    const deviceId = crashFocusDeviceIdRef.current;
    const sheetHeight = personSheetHeightRef.current;
    if (!deviceId || deviceId !== selectedMarker?.deviceId || sheetHeight === null) return;
    crashFocusDeviceIdRef.current = null;
    goToDevice(deviceId, {
      spot: crash ? crashFocusSpot(crash, selectedMarker) : null,
      paddingBottom: sheetHeight + 24,
    });
  });

  useEffect(() => {
    if (!focusCrashUserId || !mapStyle) return;
    const marker = markers.find((item) => item.userId === focusCrashUserId && !item.isSelf);
    if (!marker) return;
    onFocusCrashHandled?.();
    if (crashFocusDeviceIdRef.current === marker.deviceId) return;
    crashFocusDeviceIdRef.current = marker.deviceId;
    if (selectedDeviceId === marker.deviceId) focusCrashAbovePersonSheet();
    else onSelectDeviceId?.(marker.deviceId);
  }, [
    focusCrashUserId,
    mapStyle,
    markers,
    onFocusCrashHandled,
    onSelectDeviceId,
    selectedDeviceId,
  ]);

  useEffect(() => {
    if (!focusPlaceId) {
      handledFocusPlaceIdRef.current = null;
      return;
    }
    if (handledFocusPlaceIdRef.current === focusPlaceId) return;
    const place = places.find((item) => item.id === focusPlaceId);
    if (!place) return;
    handledFocusPlaceIdRef.current = focusPlaceId;
    onFocusPlaceHandled?.();
    zoomIntoStack({
      latitude: place.latitude,
      longitude: place.longitude,
      zoomLevel: zoomToFitPlace({
        diameterPixels: 240,
        latitude: place.latitude,
        radiusMeters: place.radiusMeters,
      }),
    });
    setSelectedPlaceKey(placeKey(place));
  }, [focusPlaceId, onFocusPlaceHandled, places, zoomIntoStack]);

  useEffect(() => {
    if (selectedPlaceKey !== null && selectedPlace === null) setSelectedPlaceKey(null);
  }, [selectedPlace, selectedPlaceKey]);

  const placeHere = selectedPlace
    ? peopleAtPlace({
        geometry: { v: 1, ...selectedPlace },
        now: Date.now(),
        people: markers.flatMap((marker) =>
          marker.timestamp === null || !selectedPlace.memberUserIds.includes(marker.userId)
            ? []
            : [{ ...marker, timestamp: marker.timestamp }],
        ),
      })
    : [];

  const edgeGroupIds = new Set(edgeMarkers.flatMap((chip) => chip.memberIds));

  const pressStack = (group: LiveMapPinGroup) => {
    pinPressAtRef.current = Date.now();
    setSelectedPlaceKey(null);
    setStackSheetDeviceIds(null);
    setGroupMenuOpen(false);
    const zoomLevel = liveMapStackExpansionZoom({ group, zoom: pins.getZoom() });
    if (zoomLevel === null) {
      clearSelection();
      setStackSheetDeviceIds(group.members.map((member) => member.deviceId));
      return;
    }
    zoomIntoStack({ latitude: group.latitude, longitude: group.longitude, zoomLevel });
  };

  const pressEdgeChip = (chip: (typeof edgeMarkers)[number]) => {
    setSelectedPlaceKey(null);
    setStackSheetDeviceIds(null);
    setGroupMenuOpen(false);
    const deviceIds = pins.groups
      .filter((group) => chip.memberIds.includes(group.id))
      .flatMap((group) => group.members.map((member) => member.deviceId));
    const [onlyDeviceId] = deviceIds;
    if (deviceIds.length === 1 && onlyDeviceId !== undefined) {
      goToDevice(onlyDeviceId);
      return;
    }
    fitEdgeGroup(deviceIds);
  };

  const isSpeedChipPin = (marker: LiveMapMarker) =>
    marker.deviceId === selectedDeviceId &&
    !(marker.mergedDeviceIds && marker.mergedDeviceIds.length > 1);
  const speedChipMarker =
    selectedSpeedLabel === null
      ? null
      : (pins.groups.find(
          (group) =>
            !edgeGroupIds.has(group.id) &&
            group.members.length === 1 &&
            group.members[0] !== undefined &&
            isSpeedChipPin(group.members[0]),
        )?.members[0] ?? null);

  const renderPerson = (
    marker: LiveMapMarker,
    motion: { arrival?: LiveMapPinOffset | undefined; gatherTo?: LiveMapPinOffset | undefined },
  ) => {
    const annotationProps = {
      ...motion,
      getZoom: pins.getZoom,
      glides: pinGlides,
      marker,
      onSelected: () => {
        pinPressAtRef.current = Date.now();
        setSelectedPlaceKey(null);
        setStackSheetDeviceIds(null);
        setGroupMenuOpen(false);
        selectDevice(marker.deviceId);
      },
      speedLabel: isSpeedChipPin(marker) ? selectedSpeedLabel : null,
    };
    return marker.isSelf ? (
      <SelfLiveMapPointAnnotation key={marker.deviceId} {...annotationProps} />
    ) : (
      <LiveMapPointAnnotation key={marker.deviceId} headingDegrees={null} {...annotationProps} />
    );
  };

  if (!mapStyle && map.isMapNotReady) {
    return (
      <View
        className="flex-1 items-center justify-center gap-3 bg-background px-8"
        accessibilityLiveRegion="polite"
      >
        <ActivityIndicator />
        <Text className="text-center text-tertiary">
          The server is still preparing the map. It will appear here when it’s ready.
        </Text>
      </View>
    );
  }

  if (!mapStyle && map.isOffline) {
    return (
      <View
        className="flex-1 items-center justify-center bg-background px-8"
        accessibilityLiveRegion="polite"
      >
        <Text className="text-center text-tertiary">
          You’re offline. The map will appear when you reconnect.
        </Text>
      </View>
    );
  }

  if (!mapStyle && map.isError) {
    return (
      <View
        className="flex-1 items-center justify-center gap-4 bg-background px-8"
        accessibilityLiveRegion="polite"
      >
        <Text className="text-center text-tertiary">
          We couldn’t load the map. Check your connection and try again.
        </Text>
        <Button variant="secondary" loading={map.isFetching} onPress={map.retryUrl}>
          <Text>Try again</Text>
        </Button>
      </View>
    );
  }

  if (!mapStyle) {
    return (
      <View
        className="flex-1 items-center justify-center bg-background"
        accessibilityLabel="Loading map"
      >
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <MapBottomInset.Provider value={bottomInset}>
      <View
        className="flex-1"
        onLayout={(event) => {
          edge.onMapLayout(event.nativeEvent.layout);
          setMapHeight(event.nativeEvent.layout.height);
        }}
      >
        <MapLibreMap
          key={map.mapRevision}
          ref={mapRef}
          style={{ flex: 1 }}
          mapStyle={mapStyleJson}
          attribution={false}
          logo={true}
          touchPitch={false}
          touchRotate={false}
          androidView="surface"
          onPress={() => {
            // MapLibre on Android reports every pin tap to the map straight after the pin's own press
            if (Platform.OS === "android" && Date.now() - pinPressAtRef.current < 500) return;
            setToastGroups([]);
            closeSheets();
          }}
          onRegionIsChanging={(feature) => {
            const { bounds, animated, userInteraction, zoom } = feature.nativeEvent;
            pins.onZoomChange(zoom);
            edge.onRegionChange([
              [bounds[2], bounds[3]],
              [bounds[0], bounds[1]],
            ]);
            maybeSuspendFollowFromRegionChange({
              properties: { animated, isUserInteraction: userInteraction },
            });
            edge.update();
          }}
          onRegionDidChange={(feature) => {
            const { bounds, center, zoom, animated, userInteraction } = feature.nativeEvent;
            pins.onZoomChange(zoom);
            edge.onRegionChange([
              [bounds[2], bounds[3]],
              [bounds[0], bounds[1]],
            ]);
            camera.onRegionDidChange({
              geometry: { coordinates: center },
              properties: { animated, isUserInteraction: userInteraction, zoomLevel: zoom },
            });
            edge.update();
          }}
          onDidFinishLoadingMap={edge.onMapReady}
          onDidFailLoadingMap={map.onMapLoadFailure}
          onDidFinishLoadingStyle={() => {
            edge.update();
            map.onStyleLoaded();

            camera.onStyleLoaded();
          }}
        >
          <Camera
            ref={cameraRef}
            initialViewState={{
              center: cameraDefaultSettings.centerCoordinate,
              zoom: cameraDefaultSettings.zoomLevel,
              ...(selectedMarker
                ? {
                    padding: {
                      top: camera.cameraPadding.paddingTop,
                      right: camera.cameraPadding.paddingRight,
                      bottom: camera.cameraPadding.paddingBottom,
                      left: camera.cameraPadding.paddingLeft,
                    },
                  }
                : {}),
            }}
          />
          <MapStyleLayers layers={map.styleLayers} />
          {selectedPlace ? (
            <GeoJSONSource
              id="selected-place"
              data={placeCirclePolygon({ v: 1, ...selectedPlace })}
            >
              <Layer
                id="selected-place-fill"
                type="fill"
                paint={{ "fill-color": colors.primary, "fill-opacity": 0.18 }}
              />
              <Layer
                id="selected-place-line"
                type="line"
                paint={{ "line-color": colors.primary, "line-width": 2 }}
              />
            </GeoJSONSource>
          ) : null}
          {crash && selectedMarker && !selectedMarker.isSelf ? (
            <CrashSpotAnnotation
              besidePin={metersBetween(crash.crash, selectedMarker) < 50}
              latitude={crash.crash.latitude}
              longitude={crash.crash.longitude}
              name={selectedMarker.name}
            />
          ) : null}
          {places.map((place) => (
            <PlaceAnnotation
              key={`place:${placeKey(place)}`}
              place={place}
              selected={placeKey(place) === selectedPlaceKey}
              onSelected={() => {
                pinPressAtRef.current = Date.now();
                closeSheets();
                setSelectedPlaceKey(placeKey(place));
              }}
            />
          ))}
          {[
            ...pins.gathering.map(({ gatherTo, marker }) => renderPerson(marker, { gatherTo })),
            ...pins.groups.map((group) => {
              if (edgeGroupIds.has(group.id)) return null;
              const [onlyMember] = group.members;
              if (group.members.length === 1 && onlyMember) {
                return renderPerson(onlyMember, { arrival: pins.arrivals.get(group.id) });
              }
              return (
                <LiveMapStackAnnotation
                  key={group.id}
                  arrival={pins.arrivals.get(group.id)}
                  getZoom={pins.getZoom}
                  glides={pinGlides}
                  group={group}
                  members={displayOrder(group.members)}
                  onPress={() => {
                    pressStack(group);
                  }}
                />
              );
            }),
          ]}
          {speedChipMarker && selectedSpeedLabel ? (
            <LiveMapSpeedChipAnnotation
              key={speedChipMarker.deviceId}
              getZoom={pins.getZoom}
              glides={pinGlides}
              label={selectedSpeedLabel}
              marker={speedChipMarker}
            />
          ) : null}
        </MapLibreMap>
        {edgeMarkers.map((chip) => (
          <LiveMapEdgeChip
            key={chip.userId}
            angle={chip.angle}
            members={displayOrder(
              pins.groups
                .filter((group) => chip.memberIds.includes(group.id))
                .flatMap((group) => group.members),
            )}
            onPress={() => {
              pressEdgeChip(chip);
            }}
            x={chip.x}
            y={chip.y}
          />
        ))}
        {map.isRefreshing ? (
          <View
            className="absolute left-3 rounded-full bg-card p-3"
            style={{ top: insets.top + 56 }}
            accessibilityLabel="Loading map"
          >
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : map.showRecoverableError ? (
          <View
            className="absolute left-3 right-16 gap-3 rounded-3xl bg-card p-4 shadow-md shadow-black/15"
            style={{ top: insets.top + 56 }}
            accessibilityLiveRegion="polite"
          >
            <Text className="text-tertiary">
              We couldn’t load the map. Check your connection and try again.
            </Text>
            <Button variant="secondary" onPress={map.retryMapLoad}>
              <Text>Try again</Text>
            </Button>
          </View>
        ) : null}
        <View
          className="absolute right-3 gap-4"
          style={{ top: insets.top + 8 }}
          onLayout={(event) => {
            edge.onControlsLayout(event.nativeEvent.layout);
          }}
        >
          <MapButtonGroup>
            {[
              <MapIconButton
                key="labels"
                icon={LayersIcon}
                active={showSymbols}
                accessibilityLabel="Show map names and symbols"
                accessibilityRole="switch"
                accessibilityState={{ checked: showSymbols }}
                onPress={map.toggleSymbols}
              />,
              timelineGroupId ? (
                <Link
                  key="timeline"
                  href={{ pathname: "/timeline", params: { groupId: timelineGroupId } }}
                  asChild
                >
                  <MapIconButton
                    icon={HistoryIcon}
                    accessibilityLabel="Timeline"
                    accessibilityRole="link"
                  />
                </Link>
              ) : null,
              hasMarkers ? (
                <MapIconButton
                  key="fit"
                  icon={ScanIcon}
                  accessibilityLabel="Show everyone"
                  accessibilityRole="button"
                  onPress={fitEveryoneInFrame}
                />
              ) : null,
            ]}
          </MapButtonGroup>
          {hasMarkers && selfMarker ? (
            <MapSurface radius={Platform.OS === "ios" ? 24 : 16}>
              <MapIconButton
                icon={LocateFixedIcon}
                active
                accessibilityLabel="Go to current location"
                accessibilityRole="button"
                onPress={goToCurrentLocation}
              />
            </MapSurface>
          ) : null}
        </View>
        <View
          pointerEvents="box-none"
          className="absolute left-3 right-20 flex-row flex-wrap gap-2"
          style={{ top: insets.top + 8 }}
          onLayout={(event) => {
            const { height, y } = event.nativeEvent.layout;
            setChipsBottom(y + height);
          }}
        >
          {canHideGroups ? (
            <MapChip
              active={groupMenuOpen}
              accessibilityLabel={
                hiddenGroupCount > 0
                  ? `Groups on the map, ${hiddenGroupCount} hidden`
                  : "Groups on the map"
              }
              accessibilityRole="button"
              accessibilityState={{ expanded: groupMenuOpen }}
              onPress={() => {
                if (groupMenuOpen) {
                  setGroupMenuOpen(false);
                  return;
                }
                openGroupMenu();
              }}
            >
              <Icon
                as={hiddenGroupCount > 0 ? EyeOffIcon : UsersIcon}
                size={16}
                className={groupMenuOpen ? "text-background" : "text-primary-text"}
              />
              <Text
                className={cn(
                  "text-[15px] font-semibold",
                  groupMenuOpen ? "text-background" : "text-foreground",
                )}
              >
                Groups
              </Text>
              <Icon
                as={ChevronDownIcon}
                size={16}
                className={groupMenuOpen ? "text-background" : "text-foreground"}
              />
            </MapChip>
          ) : null}
          <MapChip
            active={isTrayOpen}
            accessibilityLabel={
              showAttentionCount ? `People, ${needsAttentionCount} need attention` : "People"
            }
            accessibilityRole="button"
            accessibilityState={{ expanded: isTrayOpen }}
            onPress={() => {
              if (isTrayOpen) {
                onPeopleTrayOpenChange?.(false);
                return;
              }
              closeSheets();
              onPeopleTrayOpenChange?.(true);
            }}
          >
            <Text
              className={cn(
                "text-[15px] font-semibold",
                isTrayOpen ? "text-background" : "text-foreground",
              )}
            >
              People
            </Text>
            {showAttentionCount ? (
              <View
                className={cn(
                  "h-5 min-w-5 items-center justify-center rounded-full px-1",
                  hasKeyProblem ? "bg-destructive" : "bg-border-strong",
                )}
              >
                <Text
                  className={cn(
                    "text-xs font-bold leading-4",
                    hasKeyProblem ? "text-white" : "text-foreground",
                  )}
                >
                  {needsAttentionCount}
                </Text>
              </View>
            ) : null}
          </MapChip>
        </View>
        {canHideGroups && groupMenuOpen ? (
          <LiveMapGroupMenu
            groups={groupOptions}
            maxHeight={Math.max(mapHeight - insets.top - 68, 0)}
            top={insets.top + 56}
            onSetHidden={setGroupHidden}
          />
        ) : null}
        {canHideGroups &&
        (!groupMenuOpen || toastGroups.length > 0) &&
        !selectedMarker &&
        !isStackSheetOpen &&
        !missingPerson ? (
          <LiveMapHiddenGroupsNotice
            bottom={trayPeople ? trayHeight + 12 : bottomInset + 40}
            groups={groupOptions}
            toastGroupNames={toastGroups.map((group) => group.name)}
            onOpenMenu={openGroupMenu}
            onUndo={() => {
              for (const group of toastGroups) onSetGroupHidden?.(group.id, false);
              setToastGroups([]);
            }}
          />
        ) : null}
        {selectedPlace ? (
          <LiveMapPlaceSheet
            key={placeKey(selectedPlace)}
            here={placeHere}
            place={selectedPlace}
            onDelete={() => {
              onDeletePlace?.(selectedPlace, () => setSelectedPlaceKey(null));
            }}
            onDismiss={() => setSelectedPlaceKey(null)}
            onHeightChange={(height) => {
              edge.onSheetHeightChange(height);
            }}
          />
        ) : selectedMarker ? (
          <LiveMapPersonSheet
            key={selectedMarker.userId}
            battery={selectedMarker.battery}
            crash={crash}
            destination={
              selectedMarker.timestamp === null
                ? undefined
                : { latitude: selectedMarker.latitude, longitude: selectedMarker.longitude }
            }
            devices={
              selectedPersonDevices.length >= 2
                ? selectedPersonDevices.map((device) => ({
                    battery: device.marker?.battery ?? null,
                    deviceId: device.deviceId,
                    icon: device.icon,
                    isThisDevice: device.marker?.isSelf ?? false,
                    name: device.name,
                    platform: device.platform,
                    paused: device.paused,
                    speed: device.marker?.speed ?? null,
                    timestamp: device.marker?.timestamp ?? null,
                    unreadable: device.unreadable || device.marker?.unreadableGroup !== undefined,
                  }))
                : undefined
            }
            driveAlerts={
              personTimelineGroupId && Platform.OS === "android"
                ? { groupId: personTimelineGroupId, userId: selectedMarker.userId }
                : undefined
            }
            image={selectedMarker.image}
            initials={selectedMarker.initials}
            isSelf={selectedMarker.isSelf}
            liveUntilMs={selectedLiveUntilMs}
            name={selectedMarker.name}
            otherSharedGroupNames={selectedMarker.otherSharedGroupNames}
            speed={selectedMarker.speed}
            timeline={
              personTimelineGroupId
                ? { groupId: personTimelineGroupId, userId: selectedMarker.userId }
                : undefined
            }
            timestamp={selectedMarker.timestamp}
            unreadableGroup={selectedMarker.unreadableGroup}
            onHeightChange={(height) => {
              edge.onSheetHeightChange(height);
              personSheetHeightRef.current = height;
              focusCrashAbovePersonSheet();
            }}
            onDismiss={clearSelection}
            onRequestUpdate={
              onRequestUpdate &&
              (selectedPersonDevices.length === 0 ||
                selectedPersonDevices.some(
                  (device) => !device.paused && device.platform !== "ios",
                )) &&
              !(selectedPersonDevices.length === 1 && selectedMarker.unreadableGroup)
                ? () => onRequestUpdate(selectedMarker.userId)
                : undefined
            }
            onSelectDevice={(deviceId) => {
              if (markers.some((marker) => marker.deviceId === deviceId)) {
                goToDevice(deviceId);
              }
            }}
          />
        ) : isStackSheetOpen ? (
          <LiveMapStackSheet
            members={displayOrder(stackSheetMembers)}
            onDismiss={() => {
              setStackSheetDeviceIds(null);
            }}
            onHeightChange={(height) => {
              edge.onSheetHeightChange(height);
            }}
            onSelectDevice={(deviceId) => {
              setStackSheetDeviceIds(null);
              selectDevice(deviceId);
            }}
          />
        ) : missingPerson ? (
          <LiveMapMissingPersonSheet
            key={missingPerson.userId}
            devices={missingPersonDevices}
            person={missingPerson}
            onDismiss={() => {
              setMissingUserId(null);
            }}
            onRequestUpdate={
              onRequestUpdate &&
              !missingPerson.isSelf &&
              !("sharingPaused" in missingPerson) &&
              !("hiddenGroups" in missingPerson) &&
              (missingPersonDevices.length === 0 ||
                missingPersonDevices.some(
                  (device) => !device.paused && device.platform !== "ios",
                )) &&
              !(
                "reason" in missingPerson &&
                (missingPerson.reason === "groupKey" || missingPersonDevices.length === 1)
              )
                ? () => onRequestUpdate(missingPerson.userId)
                : undefined
            }
            onShowGroup={(groupId) => {
              setGroupHidden(groupId, false);
            }}
            onHeightChange={(height) => {
              edge.onSheetHeightChange(height);
            }}
          />
        ) : trayPeople ? (
          <LiveMapPeopleTray
            now={now}
            people={trayPeople}
            onDismiss={() => {
              onPeopleTrayOpenChange?.(false);
            }}
            onHeightChange={(height) => {
              setTrayHeight(height);
              edge.onSheetHeightChange(height);
            }}
            onSelectPerson={(userId) => {
              setGroupMenuOpen(false);
              const pinDeviceId = personPinDeviceId({ markers, people, pinMarkers, userId });
              if (pinDeviceId) {
                goToDevice(pinDeviceId);
                return;
              }
              setMissingUserId(userId);
            }}
          />
        ) : null}
      </View>
    </MapBottomInset.Provider>
  );
};

const placeKey = (place: MapPlace) => `${place.groupId}:${place.id}`;

const personPinDeviceId = ({
  markers,
  people,
  pinMarkers,
  userId,
}: {
  markers: readonly LiveMapMarker[];
  people: MapPeople | null;
  pinMarkers: readonly LiveMapMarker[];
  userId: string;
}) => {
  const best =
    [...(people?.upToDate ?? []), ...(people?.outOfDate ?? [])].find(
      (marker) => marker.userId === userId,
    ) ?? markers.find((marker) => marker.userId === userId);
  if (!best) return null;
  return (
    pinMarkers.find((pin) => pin.mergedDeviceIds?.includes(best.deviceId))?.deviceId ??
    best.deviceId
  );
};
