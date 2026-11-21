import { Camera, type CameraRef, Map as MapLibreMap } from "@maplibre/maplibre-react-native";
import { placeEmojiSchema, placeNameSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { LocateFixedIcon, MapPinIcon, SearchIcon, XIcon } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LiveMapBottomSheet } from "../components/map/LiveMapBottomSheet.tsx";
import { PlacePin } from "../components/map/PlacePin.tsx";
import { useNativeMapStyle } from "../components/map/useNativeMapStyle.ts";
import { PlaceSizeSlider } from "../components/PlaceSizeSlider.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import { Text } from "../components/ui/Text.tsx";
import { useCachedGroup } from "../hooks/useCachedGroup.ts";
import { useSelfDeviceLocation } from "../hooks/useSelfDeviceLocation.ts";
import { Alert } from "../lib/alert.ts";
import { authClient } from "../lib/auth-client.ts";
import { cn } from "../lib/cn.ts";
import { errorReason } from "../lib/errorReason.ts";
import {
  isPlaceEditUnchanged,
  metersPerPixel,
  PLACE_EMOJI_CHOICES,
  PLACE_RADIUS_DEFAULT,
  placeErrorMessage,
  shiftLatitudeByPixels,
} from "../lib/places.ts";
import {
  confirmDeletePlace,
  groupPlacesQueryKey,
  groupPlacesQueryOptions,
  savePlace,
} from "../lib/placeSync.ts";
import {
  type PlaceSearchResult,
  placeSearchArea,
  placeSearchState,
  suggestPlaceName,
} from "../lib/placeSearch.ts";
import { loadTrackingModule } from "../lib/trackingModule.ts";
import type { PlaceSearchBox, PlaceSearchOutcome } from "../modules/openbeacon-tracking/index.ts";
import { syncGroupPlaces } from "../lib/placeBackgroundSync.ts";
import { userMessage } from "../lib/userMessage.ts";
import { thisDeviceNoun } from "../lib/thisDeviceNoun.ts";

const PIN_ABOVE_CENTER = 150;

const SEARCH_MESSAGES = {
  error: "Search isn’t working right now. You can still move the map to the spot.",
  noResults: "Couldn’t find that. Try a postcode, or move the map to the spot.",
};

const PlaceScreen = () => {
  const { groupId, placeId } = useLocalSearchParams<{ groupId: string; placeId?: string }>();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const {
    group,
    isError: groupError,
    isPending: groupPending,
    refetch: refetchGroup,
  } = useCachedGroup(groupId);
  const places = useQuery(groupPlacesQueryOptions(groupId, userId));
  const [revision, setRevision] = useState(0);
  const [closing, setClosing] = useState(false);
  const role = group?.members.find((member) => member.userId === userId)?.role;
  const place = placeId ? places.data?.find((item) => item.id === placeId) : undefined;
  const close = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/map");
  };

  if (groupPending || (placeId && places.isPending)) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  const placeError = !!placeId && places.isError && !places.data;
  const problem = groupError
    ? "Couldn’t load your groups. Check your connection and try again."
    : !group
      ? `This group isn’t available on this ${thisDeviceNoun()}.`
      : role !== "OWNER" && role !== "ADMIN"
        ? "Only owners and admins can add or change places."
        : placeError
          ? "Couldn’t load this place. Check your connection and try again."
          : placeId && !place
            ? "This place has been deleted."
            : place && !place.geometry
              ? `This place is still syncing to this ${thisDeviceNoun()}. Try again in a few minutes.`
              : null;

  if ((problem && !closing) || !group) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
        <Text className="text-center text-foreground">{problem}</Text>
        {groupError || placeError ? (
          <Button
            variant="secondary"
            onPress={() => void (groupError ? refetchGroup() : places.refetch())}
          >
            <Text>Try again</Text>
          </Button>
        ) : null}
        <Button variant={groupError || placeError ? "ghost" : "secondary"} onPress={close}>
          <Text>Go back</Text>
        </Button>
      </View>
    );
  }

  return (
    <PlaceEditor
      key={`${placeId ?? "new"}:${revision}`}
      groupId={groupId}
      groupName={group.name}
      onClose={() => {
        setClosing(true);
        close();
      }}
      onReload={() => setRevision((current) => current + 1)}
      initialPlace={
        place?.geometry
          ? {
              emoji: place.emoji,
              expectedCiphertext: place.ciphertext,
              geometry: place.geometry,
              id: place.id,
              name: place.name,
            }
          : null
      }
    />
  );
};

const PlaceEditor = ({
  groupId,
  groupName,
  initialPlace,
  onClose,
  onReload,
}: {
  groupId: string;
  groupName: string;
  initialPlace: {
    emoji: string;
    expectedCiphertext: string;
    geometry: { latitude: number; longitude: number; radiusMeters: number };
    id: string;
    name: string;
  } | null;
  onClose: () => void;
  onReload: () => void;
}) => {
  const [place] = useState(initialPlace);
  const userId = authClient.useSession().data?.user.id;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const map = useNativeMapStyle();
  const cameraRef = useRef<CameraRef>(null);
  const selfLocation = useSelfDeviceLocation(place === null);
  const movedToSelf = useRef(false);
  const [zoom, setZoom] = useState(16);
  const [center, setCenter] = useState<{ latitude: number; longitude: number } | null>(
    place ? { latitude: place.geometry.latitude, longitude: place.geometry.longitude } : null,
  );
  const updateCenter = ([longitude, latitude]: [number, number], atZoom: number) => {
    setZoom(atZoom);
    setCenter({
      latitude: shiftLatitudeByPixels({ latitude, pixels: PIN_ABOVE_CENTER, zoom: atZoom }),
      longitude,
    });
  };
  const [radiusMeters, setRadiusMeters] = useState(
    place?.geometry.radiusMeters ?? PLACE_RADIUS_DEFAULT,
  );
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(place?.name ?? "");
  const [emoji, setEmoji] = useState(place?.emoji ?? PLACE_EMOJI_CHOICES[0]);
  const [customEmojiOpen, setCustomEmojiOpen] = useState(
    place !== null && !PLACE_EMOJI_CHOICES.some((choice) => choice === place.emoji),
  );
  const [busy, setBusy] = useState<"deleting" | "saving" | null>(null);
  const busyRef = useRef(false);
  const [movedByUser, setMovedByUser] = useState(false);
  const [searchAvailable, setSearchAvailable] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState<
    ReturnType<typeof placeSearchState> | { kind: "searching" } | null
  >(null);
  const searchRound = useRef(0);
  const searchedQuery = useRef("");
  const nameSuggestion = useRef<string | null>(null);
  const suggestedName = useRef("");
  const mapView = useRef<{
    bounds: [number, number, number, number];
    center: [number, number];
  } | null>(null);
  const unsaved = place
    ? center !== null &&
      !isPlaceEditUnchanged({
        before: place,
        after: { name, emoji, geometry: { ...center, radiusMeters } },
      })
    : name !== "" ||
      emoji !== PLACE_EMOJI_CHOICES[0] ||
      radiusMeters !== PLACE_RADIUS_DEFAULT ||
      movedByUser;
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const leavingRef = useRef(false);
  const leave = () => {
    leavingRef.current = true;
    onClose();
  };
  const mapStyleJson = useMemo(
    () => (map.mapStyle ? JSON.stringify(map.mapStyle) : null),
    [map.mapStyle],
  );

  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (leavingRef.current || !unsavedRef.current) return;
        event.preventDefault();
        Alert.alert("Discard this place?", undefined, [
          { text: "Keep editing", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              leavingRef.current = true;
              navigation.dispatch(event.data.action);
            },
          },
        ]);
      }),
    [navigation],
  );

  useEffect(() => {
    if (step !== 2) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setStep(1);
      return true;
    });
    return () => subscription.remove();
  }, [step]);

  useEffect(() => {
    if (place || center || !selfLocation || movedToSelf.current) return;
    movedToSelf.current = true;
    setCenter({ latitude: selfLocation.latitude, longitude: selfLocation.longitude });
    cameraRef.current?.jumpTo({ center: cameraCenterFor(selfLocation, 16), zoom: 16 });
  }, [center, place, selfLocation]);

  useEffect(() => {
    let active = true;
    void loadTrackingModule().then((tracking) => {
      if (active) setSearchAvailable(tracking?.isPlaceSearchAvailable() ?? false);
    });
    return () => {
      active = false;
    };
  }, []);

  const runSearch = async () => {
    const query = searchText.trim();
    if (query === "" || !searchAvailable) return;
    const round = ++searchRound.current;
    setSearch({ kind: "searching" });
    const tracking = await loadTrackingModule();
    const area = placeSearchArea(mapView.current);
    const lookUp = async (box: PlaceSearchBox | null): Promise<PlaceSearchOutcome> => {
      if (!tracking) return { status: "unavailable" };
      const outcome = await tryCatch(tracking.searchPlaces(query, box));
      return outcome.error ? { status: "error", message: outcome.error.message } : outcome.data;
    };
    const [anywhere, near] = await Promise.all([lookUp(null), area ? lookUp(area) : null]);
    if (round !== searchRound.current) return;
    searchedQuery.current = query;
    const next = placeSearchState({
      anywhere,
      near: area && near ? { area, outcome: near } : null,
    });
    if (next.kind === "unavailable") setSearchAvailable(false);
    if (next.kind === "move") {
      moveTo(next.result);
      return;
    }
    setSearch(next);
    AccessibilityInfo.announceForAccessibility(
      next.kind === "choose"
        ? `${next.results.length} places found. Choose one from the list.`
        : next.kind === "unavailable"
          ? `Address search isn’t available on this ${thisDeviceNoun()}`
          : SEARCH_MESSAGES[next.kind],
    );
  };

  const moveTo = (result: PlaceSearchResult) => {
    const atZoom = Math.max(zoom, 16);
    setMovedByUser(true);
    setCenter({ latitude: result.latitude, longitude: result.longitude });
    cameraRef.current?.flyTo({ center: cameraCenterFor(result, atZoom), zoom: atZoom });
    setSearch({ kind: "move", result });
    nameSuggestion.current = suggestPlaceName(searchedQuery.current, result);
    AccessibilityInfo.announceForAccessibility(
      `Moved to ${result.label}. Move the map if it isn’t quite right.`,
    );
  };

  const clearSearch = () => {
    searchRound.current += 1;
    setSearchText("");
    setSearch(null);
  };

  const goToNaming = () => {
    searchRound.current += 1;
    if (search?.kind === "searching" || search?.kind === "choose") setSearch(null);
    if (!place && (name === "" || name === suggestedName.current)) {
      suggestedName.current = nameSuggestion.current ?? "";
      setName(suggestedName.current);
    }
    setStep(2);
  };

  const refreshPlaces = (quietPlaceIds: readonly string[]) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: groupPlacesQueryKey(groupId) }),
      queryClient.invalidateQueries({ queryKey: ["groupHistory", groupId] }),
      userId ? tryCatch(syncGroupPlaces({ groupId, quietPlaceIds, userId })) : null,
    ]);

  const save = async () => {
    const parsedName = placeNameSchema.safeParse(name);
    if (!parsedName.success) {
      Alert.alert("Check the name", parsedName.error.issues[0]?.message);
      return;
    }
    const parsedEmoji = placeEmojiSchema.safeParse(emoji.trim());
    if (!parsedEmoji.success) {
      Alert.alert("Check the emoji", parsedEmoji.error.issues[0]?.message);
      return;
    }
    if (!center || busyRef.current) return;
    const geometry = {
      v: 1 as const,
      latitude: center.latitude,
      longitude: ((((center.longitude + 180) % 360) + 360) % 360) - 180,
      radiusMeters,
    };
    if (
      place &&
      isPlaceEditUnchanged({
        before: place,
        after: { name: parsedName.data, emoji: parsedEmoji.data, geometry },
      })
    ) {
      leave();
      return;
    }
    busyRef.current = true;
    setBusy("saving");
    const result = await tryCatch(
      savePlace({
        emoji: parsedEmoji.data,
        existing: place
          ? { before: place, expectedCiphertext: place.expectedCiphertext, placeId: place.id }
          : null,
        geometry,
        groupId,
        name: parsedName.data,
      }),
    );
    if (result.error) {
      const reason = errorReason(result.error);
      if (reason === "PLACE_CHANGED") {
        await refreshPlaces([]);
        Alert.alert(
          "Someone else changed this place",
          "It now shows their changes. Make your change again and save.",
        );
        onReload();
        return;
      }
      busyRef.current = false;
      setBusy(null);
      Alert.alert("Couldn’t save place", placeErrorMessage(reason, userMessage(result.error)));
      if (reason === "PLACE_GONE") {
        leave();
        void refreshPlaces([]);
      }
      return;
    }
    leave();
    void refreshPlaces([result.data.place.id]);
  };

  if (!mapStyleJson) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
        {map.isMapNotReady ? (
          <>
            <Text className="text-center text-tertiary">
              The server is still preparing the map. You can add places when it’s ready.
            </Text>
            <Button variant="secondary" onPress={map.retryUrl}>
              <Text>Try again</Text>
            </Button>
            <Button variant="ghost" onPress={onClose}>
              <Text>Go back</Text>
            </Button>
          </>
        ) : map.isError ? (
          <>
            <Text className="text-center text-tertiary">
              We couldn’t load the map. Check your connection and try again.
            </Text>
            <Button variant="secondary" loading={map.isFetching} onPress={map.retryUrl}>
              <Text>Try again</Text>
            </Button>
          </>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

  const title = place ? `Edit ${place.name}` : `Add place to ${groupName}`;
  const circleDiameter = center
    ? (2 * radiusMeters) / metersPerPixel({ latitude: center.latitude, zoom })
    : 0;

  return (
    <View className="flex-1 bg-background">
      <MapLibreMap
        key={map.mapRevision}
        style={{ flex: 1 }}
        mapStyle={mapStyleJson}
        attribution={false}
        logo={true}
        touchPitch={false}
        touchRotate={false}
        androidView="surface"
        onRegionIsChanging={(event) => {
          mapView.current = { bounds: event.nativeEvent.bounds, center: event.nativeEvent.center };
          if (event.nativeEvent.userInteraction && search?.kind === "choose") setSearch(null);
          if (event.nativeEvent.userInteraction && !movedByUser) setMovedByUser(true);
          if (center || place) updateCenter(event.nativeEvent.center, event.nativeEvent.zoom);
        }}
        onRegionDidChange={(event) => {
          mapView.current = { bounds: event.nativeEvent.bounds, center: event.nativeEvent.center };
          if (event.nativeEvent.userInteraction && !movedByUser) setMovedByUser(true);
          if (center || place || event.nativeEvent.userInteraction) {
            updateCenter(event.nativeEvent.center, event.nativeEvent.zoom);
          }
        }}
        onDidFailLoadingMap={map.onMapLoadFailure}
        onDidFinishLoadingStyle={map.onStyleLoaded}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: place
              ? cameraCenterFor(place.geometry, 16)
              : selfLocation
                ? cameraCenterFor(selfLocation, 16)
                : [0, 20],
            zoom: place || selfLocation ? 16 : 2,
          }}
        />
      </MapLibreMap>
      <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
        {center ? (
          <View
            className="absolute rounded-full border-2 border-primary bg-primary/20"
            style={{
              width: circleDiameter,
              height: circleDiameter,
              transform: [{ translateY: -PIN_ABOVE_CENTER }],
            }}
          />
        ) : null}
        <View style={{ transform: [{ translateY: -PIN_ABOVE_CENTER - 25 }] }}>
          <PlacePin emoji={step === 2 ? emoji : null} />
        </View>
      </View>
      <View
        pointerEvents="box-none"
        className="absolute left-4 right-4 gap-3"
        style={{ top: insets.top + 12 }}
      >
        <View className="flex-row items-center gap-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            className="size-12 items-center justify-center rounded-full bg-card shadow-md shadow-black/15"
          >
            <Icon as={XIcon} size={22} className="text-foreground" />
          </Pressable>
          {step === 1 ? (
            <View
              className={cn(
                "h-12 flex-1 flex-row items-center gap-2 rounded-full bg-card pl-4 shadow-md shadow-black/15",
                searchText === "" && "pr-4",
                !searchAvailable && "opacity-70",
              )}
            >
              {search?.kind === "searching" ? (
                <ActivityIndicator accessibilityLabel="Searching" />
              ) : (
                <Icon as={SearchIcon} size={20} className="text-tertiary" />
              )}
              <TextInput
                accessibilityLabel="Search for an address"
                accessibilityState={{ disabled: !searchAvailable }}
                editable={searchAvailable}
                value={searchText}
                onChangeText={(text) => {
                  setSearchText(text);
                  if (search?.kind === "noResults" || search?.kind === "error") setSearch(null);
                }}
                onSubmitEditing={() => void runSearch()}
                placeholder={
                  searchAvailable
                    ? "Search address or postcode"
                    : `Address search isn’t available on this ${thisDeviceNoun()}`
                }
                returnKeyType="search"
                autoCorrect={false}
                numberOfLines={1}
                className="flex-1 py-0 text-base text-foreground"
              />
              {searchText !== "" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={clearSearch}
                  className="h-12 items-center justify-center pl-1 pr-4"
                >
                  <Icon as={XIcon} size={18} className="text-tertiary" />
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View className="shrink rounded-full bg-card px-5 py-3 shadow-md shadow-black/15">
              <Text className="text-foreground font-bold" numberOfLines={1}>
                {title}
              </Text>
            </View>
          )}
        </View>
        {step === 1 && search?.kind === "choose" ? (
          <View className="rounded-2xl bg-card px-3 py-1 shadow-md shadow-black/15">
            {search.results.map((result, index) => {
              const [title, ...rest] = result.label.split(", ");
              const tag =
                result.distance === "near"
                  ? "Near the map"
                  : result.distance === "further"
                    ? "Further away"
                    : null;
              return (
                <Pressable
                  key={`${result.latitude},${result.longitude}`}
                  accessibilityRole="button"
                  accessibilityLabel={tag ? `${result.label}, ${tag}` : result.label}
                  onPress={() => moveTo(result)}
                  className={cn(
                    "flex-row items-center gap-3 py-3",
                    index > 0 && "border-t border-border",
                  )}
                >
                  <View className="size-9 items-center justify-center rounded-full bg-primary-soft">
                    <Icon as={MapPinIcon} size={18} className="text-primary-text" />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="font-bold text-foreground">{title}</Text>
                      {tag ? (
                        <View className="rounded-full bg-primary-soft px-2 py-0.5">
                          <Text className="text-xs font-semibold text-primary-text">{tag}</Text>
                        </View>
                      ) : null}
                    </View>
                    {rest.length > 0 ? (
                      <Text className="text-sm text-tertiary" numberOfLines={1}>
                        {rest.join(", ")}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {step === 1 && (search?.kind === "noResults" || search?.kind === "error") ? (
          <View className="rounded-2xl bg-card px-4 py-3 shadow-md shadow-black/15">
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              className="text-foreground"
            >
              {SEARCH_MESSAGES[search.kind]}
            </Text>
          </View>
        ) : null}
        {selfLocation ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to current location"
            onPress={() =>
              cameraRef.current?.flyTo({
                center: cameraCenterFor(selfLocation, Math.max(zoom, 15)),
                zoom: Math.max(zoom, 15),
              })
            }
            className="size-12 items-center justify-center self-end rounded-full bg-card shadow-md shadow-black/15"
          >
            <Icon as={LocateFixedIcon} size={22} className="text-foreground" />
          </Pressable>
        ) : null}
      </View>
      <KeyboardAvoidingView
        behavior="padding"
        enabled={step === 2}
        pointerEvents="box-none"
        className="absolute inset-0 justify-end"
      >
        <View pointerEvents="box-none" style={{ paddingBottom: insets.bottom }}>
          <LiveMapBottomSheet
            accessibilityLabel={step === 1 ? "Where is it?" : "Name it"}
            header={
              <View className="gap-1">
                <Text className="text-secondary text-sm font-semibold" numberOfLines={1}>
                  {step === 1 ? `${title} · Step 1 of 2` : "Step 2 of 2"}
                </Text>
                <Text className="text-foreground text-2xl font-bold">
                  {step === 1 ? "Where is it?" : "Name it"}
                </Text>
              </View>
            }
          >
            {step === 1 ? (
              <View className="gap-4 pt-2">
                {search?.kind === "move" ? (
                  <View className="rounded-xl bg-primary-soft px-4 py-3">
                    <Text accessibilityLiveRegion="polite" className="text-foreground">
                      Moved to{" "}
                      <Text className="font-bold text-foreground">{search.result.label}</Text>. Move
                      the map if it isn’t quite right.
                    </Text>
                  </View>
                ) : (
                  <Text accessibilityLiveRegion="polite" className="text-tertiary">
                    {!searchAvailable
                      ? `Your ${thisDeviceNoun()} has no address lookup service. Move the map to the spot instead.`
                      : center
                        ? "Search, or move the map so the pin sits on the place."
                        : "Finding your location. You can also search, or move the map to the place."}
                  </Text>
                )}
                <PlaceSizeSlider radiusMeters={radiusMeters} onChange={setRadiusMeters} />
                <Button disabled={!center} onPress={goToNaming}>
                  <Text>Next</Text>
                </Button>
              </View>
            ) : (
              <View className="gap-3 pt-2">
                <Text className="text-foreground font-semibold">Name</Text>
                <TextInput
                  accessibilityLabel="Name"
                  value={name}
                  onChangeText={setName}
                  maxLength={50}
                  placeholder="Home"
                  autoFocus={place === null}
                  className="rounded-lg border border-border bg-input p-4 text-foreground"
                />
                <Text className="text-foreground font-semibold">Emoji</Text>
                <View
                  accessibilityRole="radiogroup"
                  accessibilityLabel="Emoji"
                  className="flex-row flex-wrap gap-2"
                >
                  {PLACE_EMOJI_CHOICES.map((choice) => {
                    const selected = !customEmojiOpen && choice === emoji;
                    return (
                      <Pressable
                        key={choice}
                        accessibilityRole="radio"
                        accessibilityLabel={choice}
                        accessibilityState={{ checked: selected }}
                        onPress={() => {
                          setCustomEmojiOpen(false);
                          setEmoji(choice);
                        }}
                        className={cn(
                          "h-12 items-center justify-center rounded-xl border",
                          selected ? "border-2 border-primary bg-primary-soft" : "border-border",
                        )}
                        style={{ width: "15%" }}
                      >
                        <Text className="text-2xl">{choice}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {customEmojiOpen ? (
                  <TextInput
                    accessibilityLabel="Emoji"
                    value={emoji}
                    onChangeText={setEmoji}
                    maxLength={32}
                    placeholder="Type one emoji"
                    autoFocus
                    className="rounded-lg border border-border bg-input p-4 text-2xl text-foreground"
                  />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setCustomEmojiOpen(true);
                      setEmoji("");
                    }}
                  >
                    <Text className="font-semibold text-primary-text">Choose another emoji</Text>
                  </Pressable>
                )}
                <View className="flex-row gap-3 pt-1">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    disabled={busy !== null}
                    onPress={() => setStep(1)}
                  >
                    <Text>Back</Text>
                  </Button>
                  <Button
                    className="flex-1"
                    loading={busy === "saving"}
                    disabled={busy !== null}
                    onPress={save}
                  >
                    <Text>Save place</Text>
                  </Button>
                </View>
                {place ? (
                  <Button
                    variant="ghost"
                    loading={busy === "deleting"}
                    disabled={busy !== null}
                    onPress={() =>
                      confirmDeletePlace({
                        groupId,
                        name: place.name,
                        placeId: place.id,
                        onDeleting: (deleting) => {
                          busyRef.current = deleting;
                          setBusy(deleting ? "deleting" : null);
                        },
                        onDeleted: () => {
                          leave();
                          void refreshPlaces([]);
                        },
                      })
                    }
                  >
                    <Text className="text-destructive-text">Delete place</Text>
                  </Button>
                ) : null}
              </View>
            )}
          </LiveMapBottomSheet>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

const cameraCenterFor = (
  pin: { latitude: number; longitude: number },
  zoom: number,
): [number, number] => [
  pin.longitude,
  shiftLatitudeByPixels({ latitude: pin.latitude, pixels: -PIN_ABOVE_CENTER, zoom }),
];

export default PlaceScreen;
