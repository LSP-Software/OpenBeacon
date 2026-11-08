import { Camera, Layer, Map as MapLibreMap } from "@maplibre/maplibre-react-native";
import { LocateFixedIcon, MapPinIcon, ScanIcon } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import {
  type LiveMapPinGroup,
  type LiveMapPinOffset,
  liveMapStackExpansionZoom,
} from "../../lib/liveMapPinGroups.ts";
import { getSymbolVisibility } from "../../lib/protomaps-style.ts";
import { Icon } from "../ui/Icon.tsx";
import { LiveMapEdgeChip } from "./LiveMapEdgeChip.tsx";
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
  onSelectUserId,
  selectedUserId = null,
}: {
  markers?: readonly LiveMapMarker[];
  onSelectUserId?: (userId: string | null) => void;
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
        userId: group.id,
      })),
    [pins.groups],
  );
  const ignoreMapPressUntilRef = useRef(0);
  const [stackSheetUserIds, setStackSheetUserIds] = useState<readonly string[] | null>(null);
  const stackSheetMembers = (stackSheetUserIds ?? []).flatMap((userId) =>
    markers.filter((marker) => marker.userId === userId),
  );
  const isStackSheetOpen = stackSheetMembers.length > 1;
  const edge = useLiveMapEdgeMarkers({
    markers: edgeSubjects,
    mapRevision: map.mapRevision,
    sheetKey: selectedMarker?.userId ?? (isStackSheetOpen ? "stack" : null),
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
  const selfMarker = markers.find((marker) => marker.isSelf) ?? null;
  const hasMarkers = markers.length > 0;
  const camera = useLiveMapCamera({
    edge,
    mapStyle,
    mapRevision: map.mapRevision,
    markers,
    onClearSelection: selection.clearSelectionFromReact,
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
    goToEdgeMarker,
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

  const edgeGroupIds = new Set(edgeMarkers.flatMap((chip) => chip.memberIds));

  const pressStack = (group: LiveMapPinGroup) => {
    ignoreMapPressUntilRef.current = Date.now() + 500;
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
      goToEdgeMarker(onlyUserId);
      return;
    }
    fitEdgeGroup({ chipIds: chip.memberIds, userIds });
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
      onSelected: () => {
        if (Platform.OS === "android") ignoreMapPressUntilRef.current = Date.now() + 500;
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
        onPress={() => {
          // MapLibre on Android reports a pin or stack tap to the map ~300ms later, which would close the sheet it opened
          if (Date.now() < ignoreMapPressUntilRef.current) return;
          setStackSheetUserIds(null);
          clearSelectionFromReact();
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
        {pins.gathering.map(({ gatherTo, marker }) => renderPerson(marker, { gatherTo }))}
        {pins.groups.map((group) => {
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
              onPress={() => {
                pressStack(group);
              }}
            />
          );
        })}
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
      ) : null}
    </View>
  );
};
