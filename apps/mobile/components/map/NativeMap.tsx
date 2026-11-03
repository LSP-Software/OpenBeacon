import { Camera, MapView } from "@maplibre/maplibre-react-native";
import { ArrowUpIcon, LocateFixedIcon, MapPinIcon, ScanIcon } from "lucide-react-native";
import { ActivityIndicator, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { Icon } from "../ui/Icon.tsx";
import { LiveMapMarkerPin } from "./LiveMapMarkerPin.tsx";
import { LiveMapPointAnnotation, SelfLiveMapPointAnnotation } from "./LiveMapPointAnnotation.tsx";
import { LiveMapPersonSheet } from "./LiveMapPersonSheet.tsx";
import { useLiveMapEdgeMarkers } from "./useLiveMapEdgeMarkers.ts";
import { useLiveMapCamera } from "./useLiveMapCamera.ts";
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
  const edge = useLiveMapEdgeMarkers({ markers, selectedUserId: selectedMarker?.userId ?? null });
  const { edgeMarkers, mapRef } = edge;
  const selection = useLiveMapSelection({
    selectedUserId,
    onSelectUserId,
    isEdgeMarker: edge.isEdgeMarker,
  });
  const selfMarker = markers.find((marker) => marker.isSelf) ?? null;
  const hasMarkers = markers.length > 0;
  const camera = useLiveMapCamera({
    edge,
    mapStyle,
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
    fitEveryoneInFrame,
    goToCurrentLocation,
    goToEdgeMarker,
    maybeSuspendFollowFromRegionChange,
  } = camera;
  const {
    annotationRemountTokens,
    clearSelectionFromReact,
    handleAnnotationDeselected,
    handleAnnotationSelected,
  } = selection;
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
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        mapStyle={mapStyle}
        attributionEnabled={false}
        logoEnabled={true}
        pitchEnabled={false}
        rotateEnabled={false}
        regionDidChangeDebounceTime={0}
        surfaceView={Platform.OS === "android"}
        onPress={clearSelectionFromReact}
        onRegionIsChanging={(feature) => {
          edge.onRegionChange(feature.properties.visibleBounds ?? null);
          maybeSuspendFollowFromRegionChange(feature);
          edge.update();
        }}
        onRegionDidChange={(feature) => {
          edge.onRegionChange(feature.properties.visibleBounds ?? null);
          camera.onRegionDidChange(feature);
          edge.update();
        }}
        onDidFailLoadingMap={map.onMapLoadFailure}
        onDidFinishLoadingStyle={() => {
          edge.update();
          map.onStyleLoaded();

          camera.onStyleLoaded();
        }}
      >
        <Camera ref={cameraRef} defaultSettings={cameraDefaultSettings} />
        {markers.map((marker) =>
          edgeMarkers.some((edge) => edge.userId === marker.userId) ? null : marker.isSelf ? (
            <SelfLiveMapPointAnnotation
              key={`${marker.userId}:${annotationRemountTokens[marker.userId] ?? 0}`}
              marker={marker}
              onDeselected={() => {
                handleAnnotationDeselected(marker.userId);
              }}
              onSelected={() => {
                handleAnnotationSelected(marker.userId);
              }}
            />
          ) : (
            <LiveMapPointAnnotation
              key={`${marker.userId}:${annotationRemountTokens[marker.userId] ?? 0}`}
              headingDegrees={null}
              marker={marker}
              onDeselected={() => {
                handleAnnotationDeselected(marker.userId);
              }}
              onSelected={() => {
                handleAnnotationSelected(marker.userId);
              }}
            />
          ),
        )}
      </MapView>
      {edgeMarkers.map((edge) => {
        const marker = markers.find((item) => item.userId === edge.userId);
        if (!marker) return null;
        return (
          <Pressable
            key={edge.userId}
            accessibilityRole="button"
            accessibilityLabel={`Go to ${marker.name}`}
            onPress={() => goToEdgeMarker(marker.userId)}
            style={{ position: "absolute", left: edge.x - 24, top: edge.y - 24 }}
          >
            <LiveMapMarkerPin
              image={marker.image}
              initials={marker.initials}
              name={marker.name}
              ringColor={marker.ringColor}
              timestamp={marker.timestamp}
            />
            <View
              pointerEvents="none"
              className="absolute bottom-0 right-0 size-5 items-center justify-center rounded-full border border-border bg-card"
              style={{ transform: [{ rotate: `${edge.angle}deg` }] }}
            >
              <Icon as={ArrowUpIcon} size={13} className="text-foreground" />
            </View>
          </Pressable>
        );
      })}
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
      ) : null}
    </View>
  );
};
