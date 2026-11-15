import { Camera, type CameraRef, Map as MapLibreMap } from "@maplibre/maplibre-react-native";
import { placeEmojiSchema, placeNameSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LocateFixedIcon, XIcon } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
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
import { syncGroupPlaces } from "../lib/placeBackgroundSync.ts";

const PIN_ABOVE_CENTER = 150;

const PlaceScreen = () => {
  const { groupId, placeId } = useLocalSearchParams<{ groupId: string; placeId?: string }>();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const { group, isPending: groupPending } = useCachedGroup(groupId);
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

  const problem = !group
    ? "This group isn’t available on this phone."
    : role !== "OWNER" && role !== "ADMIN"
      ? "Only owners and admins can add or change places."
      : placeId && places.isError
        ? "Couldn’t load this place. Check your connection and try again."
        : placeId && !place
          ? "This place has been deleted."
          : place && !place.geometry
            ? "This place is still syncing to this phone. Try again in a few minutes."
            : null;

  if ((problem && !closing) || !group) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
        <Text className="text-center text-foreground">{problem}</Text>
        <Button variant="outline" onPress={close}>
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
  const mapStyleJson = useMemo(
    () => (map.mapStyle ? JSON.stringify(map.mapStyle) : null),
    [map.mapStyle],
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

  const refreshPlaces = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: groupPlacesQueryKey(groupId) }),
      queryClient.invalidateQueries({ queryKey: ["placeTransitions", groupId] }),
      userId ? tryCatch(syncGroupPlaces({ announce: false, groupId, userId })) : null,
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
    busyRef.current = true;
    setBusy("saving");
    const result = await tryCatch(
      savePlace({
        emoji: parsedEmoji.data,
        existing: place
          ? { expectedCiphertext: place.expectedCiphertext, placeId: place.id }
          : null,
        geometry: {
          v: 1,
          latitude: center.latitude,
          longitude: ((((center.longitude + 180) % 360) + 360) % 360) - 180,
          radiusMeters,
        },
        groupId,
        name: parsedName.data,
      }),
    );
    if (result.error) {
      const reason = errorReason(result.error);
      if (reason === "PLACE_CHANGED") {
        await refreshPlaces();
        Alert.alert(
          "Someone else changed this place",
          "It now shows their changes. Make your change again and save.",
        );
        onReload();
        return;
      }
      busyRef.current = false;
      setBusy(null);
      Alert.alert("Unable to save place", placeErrorMessage(reason, result.error.message));
      if (reason === "PLACE_GONE") {
        onClose();
        void refreshPlaces();
      }
      return;
    }
    onClose();
    void refreshPlaces();
  };

  if (!mapStyleJson) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
        {map.isError ? (
          <>
            <Text className="text-center text-muted-foreground">
              We couldn’t load the map. Check your connection and try again.
            </Text>
            <Button variant="outline" loading={map.isFetching} onPress={map.retryUrl}>
              <Text>Try again</Text>
            </Button>
          </>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

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
          if (center || place) updateCenter(event.nativeEvent.center, event.nativeEvent.zoom);
        }}
        onRegionDidChange={(event) => {
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
        className="absolute left-4 right-4 flex-row items-center gap-3"
        style={{ top: insets.top + 12 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          className="size-12 items-center justify-center rounded-full bg-card shadow-md shadow-black/15"
        >
          <Icon as={XIcon} size={22} className="text-foreground" />
        </Pressable>
        <View className="shrink rounded-full bg-card px-5 py-3 shadow-md shadow-black/15">
          <Text className="text-foreground font-bold" numberOfLines={1}>
            {place ? `Edit ${place.name}` : `Add place to ${groupName}`}
          </Text>
        </View>
      </View>
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
          className="absolute right-4 size-12 items-center justify-center rounded-full bg-card shadow-md shadow-black/15"
          style={{ top: insets.top + 76 }}
        >
          <Icon as={LocateFixedIcon} size={22} className="text-foreground" />
        </Pressable>
      ) : null}
      <KeyboardAvoidingView
        behavior="padding"
        pointerEvents="box-none"
        className="absolute inset-0 justify-end"
      >
        <View pointerEvents="box-none" style={{ paddingBottom: insets.bottom }}>
          <LiveMapBottomSheet
            accessibilityLabel={step === 1 ? "Where is it?" : "Name it"}
            header={
              <View className="gap-1">
                <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Step {step} of 2
                </Text>
                <Text className="text-foreground text-2xl font-bold">
                  {step === 1 ? "Where is it?" : "Name it"}
                </Text>
              </View>
            }
          >
            {step === 1 ? (
              <View className="gap-4 pt-2">
                <Text className="text-muted-foreground">
                  {center
                    ? "Move the map so the pin sits on the place."
                    : "Finding your location. You can also move the map to the place."}
                </Text>
                <PlaceSizeSlider radiusMeters={radiusMeters} onChange={setRadiusMeters} />
                <Button disabled={!center} onPress={() => setStep(2)}>
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
                          selected ? "border-2 border-primary bg-primary/10" : "border-border",
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
                    <Text className="font-semibold text-primary">Choose another emoji</Text>
                  </Pressable>
                )}
                <View className="flex-row gap-3 pt-1">
                  <Button
                    variant="outline"
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
                          onClose();
                          void refreshPlaces();
                        },
                      })
                    }
                  >
                    <Text className="text-destructive">Delete place</Text>
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
