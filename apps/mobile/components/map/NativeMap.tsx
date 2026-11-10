import { Camera, Layer, Map as MapLibreMap } from "@maplibre/maplibre-react-native";
import { LocateFixedIcon, MapPinIcon, ScanIcon, UsersIcon } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, type GestureResponderEvent, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import {
  type LiveMapPinGroup,
  type LiveMapPinOffset,
  liveMapStackExpansionZoom,
} from "../../lib/liveMapPinGroups.ts";
import { cn } from "../../lib/cn.ts";
import type { MapPeople } from "../../lib/mapPeopleTypes.ts";
import { getSymbolVisibility } from "../../lib/protomaps-style.ts";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";
import { LiveMapEdgeChip } from "./LiveMapEdgeChip.tsx";
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
  markers = [],
  now = 0,
  onPeopleTrayOpenChange,
  onSelectUserId,
  people = null,
  peopleTrayOpen = false,
  selectedUserId = null,
}: {
  markers?: readonly LiveMapMarker[];
  now?: number;
  onPeopleTrayOpenChange?: (open: boolean) => void;
  onSelectUserId?: (userId: string | null) => void;
  people?: MapPeople | null;
  peopleTrayOpen?: boolean;
  selectedUserId?: string | null;
} = {}) => {
  const insets = useSafeAreaInsets();
  const map = useNativeMapStyle();
  const { mapStyle, pmtilesUrl, showSymbols } = map;
  const selectedMarker = markers.find((marker) => marker.userId === selectedUserId) ?? null;
  const pins = useLiveMapPinGroups(markers);
  const edgeSubjects = useMemo(
    () =>
      pins.groups.map((group) => ({
        latitude: group.latitude,
        longitude: group.longitude,
        memberUserIds: group.members.map((member) => member.userId),
        userId: group.id,
      })),
    [pins.groups],
  );
  const lastMarkerPressRef = useRef<{ atMs: number; x: number; y: number } | null>(null);
  const [stackSheetUserIds, setStackSheetUserIds] = useState<readonly string[] | null>(null);
  const stackSheetMembers = (stackSheetUserIds ?? []).flatMap((userId) =>
    markers.filter((marker) => marker.userId === userId),
  );
  const isStackSheetOpen = stackSheetMembers.length > 1;
  const [missingUserId, setMissingUserId] = useState<string | null>(null);
  const missingPerson =
    [...(people?.cantLocate ?? []), ...(people?.cantRead ?? [])].find(
      (person) => person.userId === missingUserId,
    ) ?? null;
  const isTrayOpen =
    peopleTrayOpen && selectedMarker === null && !isStackSheetOpen && missingUserId === null;
  const trayPeople = isTrayOpen ? people : null;
  const [trayHeight, setTrayHeight] = useState(0);
  const unreadableMarkerCount = markers.filter(
    (marker) => marker.unreadableGroup !== undefined,
  ).length;
  const hasKeyProblem = (people?.cantRead.length ?? 0) + unreadableMarkerCount > 0;
  const needsAttentionCount =
    (people?.cantLocate.length ?? 0) + (people?.cantRead.length ?? 0) + unreadableMarkerCount;
  const showAttentionCount =
    people !== null && people.finding.length === 0 && needsAttentionCount > 0;
  useEffect(() => {
    if (stackSheetUserIds === null) return;
    const stillTogether =
      selectedUserId === null &&
      pins.groups.some((group) =>
        stackSheetUserIds.every((userId) =>
          group.members.some((member) => member.userId === userId),
        ),
      );
    if (!stillTogether) setStackSheetUserIds(null);
  }, [pins.groups, selectedUserId, stackSheetUserIds]);
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
    selectedUserId,
    onSelectUserId,
    isMarkerReplaced: (userId) => {
      const group = pins.groups.find((item) =>
        item.members.some((member) => member.userId === userId),
      );
      return group !== undefined && (group.members.length > 1 || edge.isEdgeMarker(group.id));
    },
  });
  const closeSheets = () => {
    setStackSheetUserIds(null);
    setMissingUserId(null);
    selection.clearSelectionFromReact();
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
    onSelectUser: selection.handleAnnotationSelected,
    pmtilesUrl,
    selectedMarker,
    selectedUserId,
    topInset: insets.top,
  });
  const {
    cameraRef,
    cameraDefaultSettings,
    fitEdgeGroup,
    fitEveryoneInFrame,
    goToCurrentLocation,
    goToPerson,
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
        Number(second.userId === selectedUserId) - Number(first.userId === selectedUserId) ||
        Number(first.isSelf) - Number(second.isSelf) ||
        first.name.localeCompare(second.name),
    );

  useEffect(() => {
    if (missingUserId === null) return;
    const hasMarker = markers.some((marker) => marker.userId === missingUserId);
    if (!hasMarker && missingPerson !== null) return;
    setMissingUserId(null);
    if (hasMarker) goToPerson(missingUserId);
  }, [goToPerson, markers, missingPerson, missingUserId]);

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
    setStackSheetUserIds(null);
    const zoomLevel = liveMapStackExpansionZoom({ group, zoom: pins.getZoom() });
    if (zoomLevel === null) {
      clearSelectionFromReact();
      setStackSheetUserIds(group.members.map((member) => member.userId));
      return;
    }
    zoomIntoStack({ latitude: group.latitude, longitude: group.longitude, zoomLevel });
  };

  const pressEdgeChip = (chip: (typeof edgeMarkers)[number]) => {
    setStackSheetUserIds(null);
    const userIds = pins.groups
      .filter((group) => chip.memberIds.includes(group.id))
      .flatMap((group) => group.members.map((member) => member.userId));
    const [onlyUserId] = userIds;
    if (userIds.length === 1 && onlyUserId !== undefined) {
      goToPerson(onlyUserId);
      return;
    }
    fitEdgeGroup(userIds);
  };

  const renderPerson = (
    marker: LiveMapMarker,
    motion: { arrival?: LiveMapPinOffset | undefined; gatherTo?: LiveMapPinOffset | undefined },
  ) => {
    const annotationProps = {
      ...motion,
      marker,
      onDeselected: () => {
        handleAnnotationDeselected(marker.userId);
      },
      onSelected: (event?: GestureResponderEvent) => {
        rememberMarkerPress(event);
        setStackSheetUserIds(null);
        handleAnnotationSelected(marker.userId);
      },
    };
    const key = `${marker.userId}:${annotationRemountTokens[marker.userId] ?? 0}`;
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
      {selectedMarker ? (
        <LiveMapPersonSheet
          key={selectedMarker.userId}
          battery={selectedMarker.battery}
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
        />
      ) : isStackSheetOpen ? (
        <LiveMapStackSheet
          members={displayOrder(stackSheetMembers)}
          onDismiss={() => {
            setStackSheetUserIds(null);
          }}
          onHeightChange={(height) => {
            edge.onSheetHeightChange(height);
          }}
          onSelectUser={(userId) => {
            setStackSheetUserIds(null);
            handleAnnotationSelected(userId);
          }}
        />
      ) : missingPerson ? (
        <LiveMapMissingPersonSheet
          key={missingPerson.userId}
          person={missingPerson}
          onDismiss={() => {
            setMissingUserId(null);
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
            if (markers.some((marker) => marker.userId === userId)) {
              goToPerson(userId);
              return;
            }
            setMissingUserId(userId);
          }}
        />
      ) : null}
    </View>
  );
};
