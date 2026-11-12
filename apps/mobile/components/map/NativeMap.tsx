import { Camera, Layer, Map as MapLibreMap } from "@maplibre/maplibre-react-native";
import {
  EyeOffIcon,
  LayersIcon,
  LocateFixedIcon,
  MapPinIcon,
  ScanIcon,
  UsersIcon,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  BackHandler,
  type GestureResponderEvent,
  Pressable,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import {
  type LiveMapPinGroup,
  type LiveMapPinOffset,
  liveMapStackExpansionZoom,
  mergeSamePersonDevices,
} from "../../lib/liveMapPinGroups.ts";
import { cn } from "../../lib/cn.ts";
import type { MapGroupOption, MapMemberDevice, MapPeople } from "../../lib/mapPeopleTypes.ts";
import { getSymbolVisibility } from "../../lib/protomaps-style.ts";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";
import { LiveMapEdgeChip } from "./LiveMapEdgeChip.tsx";
import { LiveMapGroupMenu, LiveMapHiddenGroupsNotice } from "./LiveMapGroupVisibility.tsx";
import { LiveMapMissingPersonSheet } from "./LiveMapMissingPersonSheet.tsx";
import { LiveMapPeopleTray } from "./LiveMapPeopleTray.tsx";
import { LiveMapPointAnnotation, SelfLiveMapPointAnnotation } from "./LiveMapPointAnnotation.tsx";
import { LiveMapPersonSheet } from "./LiveMapPersonSheet.tsx";
import { LiveMapStackAnnotation } from "./LiveMapStackAnnotation.tsx";
import { LiveMapStackSheet } from "./LiveMapStackSheet.tsx";
import { useLiveMapEdgeMarkers } from "./useLiveMapEdgeMarkers.ts";
import { useLiveMapCamera } from "./useLiveMapCamera.ts";
import { useLiveMapPinGroups } from "./useLiveMapPinGroups.ts";
import { useLiveMapSelection } from "./useLiveMapSelection.ts";
import { useNativeMapStyle } from "./useNativeMapStyle.ts";

export const NativeMap = ({
  devices = [],
  groupOptions = null,
  markers = [],
  now = 0,
  onPeopleTrayOpenChange,
  onSetGroupHidden,
  onSelectDeviceId,
  people = null,
  peopleTrayOpen = false,
  selectedDeviceId = null,
}: {
  devices?: readonly (MapMemberDevice & { unreadable: boolean })[];
  groupOptions?: readonly MapGroupOption[] | null;
  markers?: readonly LiveMapMarker[];
  now?: number;
  onPeopleTrayOpenChange?: (open: boolean) => void;
  onSetGroupHidden?: (groupId: string, hidden: boolean) => void;
  onSelectDeviceId?: (deviceId: string | null) => void;
  people?: MapPeople | null;
  peopleTrayOpen?: boolean;
  selectedDeviceId?: string | null;
} = {}) => {
  const insets = useSafeAreaInsets();
  const map = useNativeMapStyle();
  const { mapStyle, pmtilesUrl, showSymbols } = map;
  const selectedMarker = markers.find((marker) => marker.deviceId === selectedDeviceId) ?? null;
  const pinMarkers = useMemo(() => mergeSamePersonDevices(markers), [markers]);
  const pins = useLiveMapPinGroups(pinMarkers);
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
  const lastMarkerPressRef = useRef<{ atMs: number; x: number; y: number } | null>(null);
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
      ...(people?.cantLocate ?? []),
      ...(people?.cantRead ?? []),
      ...(people?.hidden ?? []),
    ].find((person) => person.userId === missingUserId) ?? null;
  const isTrayOpen =
    peopleTrayOpen && selectedMarker === null && !isStackSheetOpen && missingUserId === null;
  const trayPeople = isTrayOpen ? people : null;
  const [trayHeight, setTrayHeight] = useState(0);
  const [mapHeight, setMapHeight] = useState(0);
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
      selectedMarker?.userId ??
      (isStackSheetOpen
        ? "stack"
        : missingPerson
          ? `missing:${missingPerson.userId}`
          : trayPeople
            ? "tray"
            : null),
    topInset: insets.top,
  });
  const { edgeMarkers, mapRef } = edge;
  const selection = useLiveMapSelection({
    selectedDeviceId,
    onSelectDeviceId,
    isMarkerReplaced: (deviceId) => {
      const group = pins.groups.find((item) =>
        item.members.some((member) => member.deviceId === deviceId),
      );
      return group !== undefined && (group.members.length > 1 || edge.isEdgeMarker(group.id));
    },
  });
  const closeSheets = () => {
    setStackSheetDeviceIds(null);
    setMissingUserId(null);
    setGroupMenuOpen(false);
    selection.clearSelectionFromReact();
  };
  const openGroupMenu = () => {
    closeSheets();
    setGroupMenuOpen(true);
  };
  const selfMarker = markers.find((marker) => marker.isSelf) ?? null;
  const hasMarkers = markers.length > 0;
  const camera = useLiveMapCamera({
    bottomOverlayHeight: trayPeople ? trayHeight : 0,
    edge,
    mapStyle,
    mapRevision: map.mapRevision,
    markers,
    onClearSelection: closeSheets,
    onSelectDevice: selection.handleAnnotationSelected,
    pmtilesUrl,
    selectedMarker,
    selectedDeviceId,
    topInset: insets.top,
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
  const {
    annotationRemountTokens,
    clearSelectionFromReact,
    handleAnnotationDeselected,
    handleAnnotationSelected,
  } = selection;
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
    if (!groupMenuOpen) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setGroupMenuOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [groupMenuOpen]);

  useEffect(() => {
    if (missingUserId === null) return;
    const hasMarker = markers.some((marker) => marker.userId === missingUserId);
    if (!hasMarker && missingPerson !== null) return;
    setMissingUserId(null);
    const pinDeviceId = personPinDeviceId({ markers, people, pinMarkers, userId: missingUserId });
    if (pinDeviceId) goToDevice(pinDeviceId);
  }, [goToDevice, markers, missingPerson, missingUserId, people, pinMarkers]);

  const edgeGroupIds = new Set(edgeMarkers.flatMap((chip) => chip.memberIds));

  const rememberMarkerPress = (event?: GestureResponderEvent) => {
    if (!event) return;
    lastMarkerPressRef.current = {
      atMs: Date.now(),
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
    };
  };

  const pressStack = (group: LiveMapPinGroup, event?: GestureResponderEvent) => {
    rememberMarkerPress(event);
    setStackSheetDeviceIds(null);
    setGroupMenuOpen(false);
    const zoomLevel = liveMapStackExpansionZoom({ group, zoom: pins.getZoom() });
    if (zoomLevel === null) {
      clearSelectionFromReact();
      setStackSheetDeviceIds(group.members.map((member) => member.deviceId));
      return;
    }
    zoomIntoStack({ latitude: group.latitude, longitude: group.longitude, zoomLevel });
  };

  const pressEdgeChip = (chip: (typeof edgeMarkers)[number]) => {
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

  const renderPerson = (
    marker: LiveMapMarker,
    motion: { arrival?: LiveMapPinOffset | undefined; gatherTo?: LiveMapPinOffset | undefined },
  ) => {
    const annotationProps = {
      ...motion,
      marker,
      onDeselected: () => {
        handleAnnotationDeselected(marker.deviceId);
      },
      onSelected: (event?: GestureResponderEvent) => {
        rememberMarkerPress(event);
        setStackSheetDeviceIds(null);
        setGroupMenuOpen(false);
        handleAnnotationSelected(marker.deviceId);
      },
    };
    const key = `${marker.deviceId}:${annotationRemountTokens[marker.deviceId] ?? 0}`;
    return marker.isSelf ? (
      <SelfLiveMapPointAnnotation key={key} {...annotationProps} />
    ) : (
      <LiveMapPointAnnotation key={key} headingDegrees={null} {...annotationProps} />
    );
  };

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
        mapStyle={JSON.stringify(mapStyle)}
        attribution={false}
        logo={true}
        touchPitch={false}
        touchRotate={false}
        androidView="surface"
        onPress={(event) => {
          const lastMarkerPress = lastMarkerPressRef.current;
          lastMarkerPressRef.current = null;
          const [x, y] = event.nativeEvent.point;
          // MapLibre on Android also reports a marker tap to the map ~300ms later, which would close the sheet it opened
          if (
            lastMarkerPress &&
            Date.now() - lastMarkerPress.atMs < 1500 &&
            Math.hypot(x - lastMarkerPress.x, y - lastMarkerPress.y) < 24
          ) {
            return;
          }
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
        {map.symbolLayerIds.map((id) => (
          <Layer
            key={id}
            id={id}
            type="symbol"
            layout={{ visibility: getSymbolVisibility(showSymbols) }}
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
                group={group}
                members={displayOrder(group.members)}
                onPress={(event) => {
                  pressStack(group, event);
                }}
              />
            );
          }),
        ]}
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
      {map.showRecoverableError || map.isRefreshing ? (
        <View
          className="absolute left-3 top-14 rounded-full bg-card p-3"
          accessibilityLabel="Loading map"
        >
          <ActivityIndicator />
        </View>
      ) : null}
      <View
        className="absolute right-3 top-14 gap-2"
        onLayout={(event) => {
          edge.onControlsLayout(event.nativeEvent.layout);
        }}
      >
        <Pressable
          accessibilityLabel="Show map names and symbols"
          accessibilityRole="switch"
          accessibilityState={{ checked: showSymbols }}
          onPress={map.toggleSymbols}
          className="size-11 items-center justify-center rounded-full border border-border bg-card shadow-sm shadow-black/10"
        >
          <Icon
            as={MapPinIcon}
            size={20}
            className={showSymbols ? "text-foreground" : "text-muted"}
          />
        </Pressable>
        {canHideGroups ? (
          <Pressable
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
            className={cn(
              "size-11 items-center justify-center rounded-full border shadow-sm shadow-black/10",
              groupMenuOpen ? "border-foreground bg-foreground" : "border-border bg-card",
            )}
          >
            <Icon
              as={LayersIcon}
              size={20}
              className={groupMenuOpen ? "text-background" : "text-foreground"}
            />
            {hiddenGroupCount > 0 ? (
              <View className="absolute -right-1 -top-1 size-5 items-center justify-center rounded-full border-2 border-card bg-muted">
                <Icon as={EyeOffIcon} size={11} className="text-white" />
              </View>
            ) : null}
          </Pressable>
        ) : null}
        {hasMarkers ? (
          <>
            <Pressable
              accessibilityLabel="Show everyone"
              accessibilityRole="button"
              onPress={fitEveryoneInFrame}
              className="size-11 items-center justify-center rounded-full border border-border bg-card shadow-sm shadow-black/10"
            >
              <Icon as={ScanIcon} size={20} className="text-foreground" />
            </Pressable>
            {selfMarker ? (
              <Pressable
                accessibilityLabel="Go to current location"
                accessibilityRole="button"
                onPress={goToCurrentLocation}
                className="size-11 items-center justify-center rounded-full border border-border bg-card shadow-sm shadow-black/10"
              >
                <Icon as={LocateFixedIcon} size={20} className="text-foreground" />
              </Pressable>
            ) : null}
          </>
        ) : null}
        <Pressable
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
          className={cn(
            "size-11 items-center justify-center rounded-full border shadow-sm shadow-black/10",
            isTrayOpen ? "border-foreground bg-foreground" : "border-border bg-card",
          )}
        >
          <Icon
            as={UsersIcon}
            size={20}
            className={isTrayOpen ? "text-background" : "text-foreground"}
          />
          {showAttentionCount ? (
            <View
              className={cn(
                "absolute -right-1 -top-1 h-5 min-w-5 items-center justify-center rounded-full border-2 border-card px-1",
                hasKeyProblem ? "bg-destructive" : "bg-muted",
              )}
            >
              <Text className="text-[11px] font-bold leading-[13px] text-white">
                {needsAttentionCount}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      {canHideGroups && groupMenuOpen ? (
        <LiveMapGroupMenu
          groups={groupOptions}
          maxHeight={Math.max(mapHeight - 68, 0)}
          onSetHidden={setGroupHidden}
        />
      ) : null}
      {canHideGroups &&
      (!groupMenuOpen || toastGroups.length > 0) &&
      !selectedMarker &&
      !isStackSheetOpen &&
      !missingPerson ? (
        <LiveMapHiddenGroupsNotice
          bottom={trayPeople ? trayHeight + 12 : 40}
          groups={groupOptions}
          toastGroupNames={toastGroups.map((group) => group.name)}
          onOpenMenu={openGroupMenu}
          onUndo={() => {
            for (const group of toastGroups) onSetGroupHidden?.(group.id, false);
            setToastGroups([]);
          }}
        />
      ) : null}
      {selectedMarker ? (
        <LiveMapPersonSheet
          key={selectedMarker.userId}
          battery={selectedMarker.battery}
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
                  timestamp: device.marker?.timestamp ?? null,
                  unreadable: device.unreadable || device.marker?.unreadableGroup !== undefined,
                }))
              : undefined
          }
          image={selectedMarker.image}
          initials={selectedMarker.initials}
          isSelf={selectedMarker.isSelf}
          name={selectedMarker.name}
          otherSharedGroupNames={selectedMarker.otherSharedGroupNames}
          timestamp={selectedMarker.timestamp}
          unreadableGroup={selectedMarker.unreadableGroup}
          onHeightChange={(height) => {
            edge.onSheetHeightChange(height);
          }}
          onDismiss={clearSelectionFromReact}
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
            handleAnnotationSelected(deviceId);
          }}
        />
      ) : missingPerson ? (
        <LiveMapMissingPersonSheet
          key={missingPerson.userId}
          person={missingPerson}
          onDismiss={() => {
            setMissingUserId(null);
          }}
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
  );
};

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
