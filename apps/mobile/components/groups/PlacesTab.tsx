import { useIsFocused } from "@react-navigation/native";
import { MAX_PLACES_PER_GROUP } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import {
  BellIcon,
  ChevronRightIcon,
  HourglassIcon,
  InfoIcon,
  MapPinIcon,
  PlusIcon,
} from "lucide-react-native";
import { useEffect } from "react";
import { Platform, Pressable, View } from "react-native";
import { LoadingIndicator } from "../LoadingIndicator.tsx";
import { groupedListClassName, groupedRowClassName, groupedRowStyle } from "./groupedRows.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Switch } from "../ui/Switch.tsx";
import { Text } from "../ui/Text.tsx";
import { useCachedGroup } from "../../hooks/useCachedGroup.ts";
import { useMemberNames } from "../../hooks/useMemberNames.ts";
import { useUnits } from "../../hooks/useUnits.ts";
import { Alert } from "../../lib/alert.ts";
import { trpc } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { authClient } from "../../lib/auth-client.ts";
import type { LiveMapPosition } from "../../lib/mapTrackingTypes.ts";
import { describePeopleHere, formatPlaceSize, peopleAtPlace } from "../../lib/places.ts";
import { requestNotificationPermissions } from "../../lib/notifications.ts";
import { markPlacesUnsynced, syncGroupPlaces } from "../../lib/placeBackgroundSync.ts";
import { catchUpGroupPlaces } from "../../lib/placeCatchUp.ts";
import { groupPlacesQueryKey, groupPlacesQueryOptions } from "../../lib/placeSync.ts";
import { registeredDeviceQueryOptions } from "../../lib/registeredDevice.ts";
import { storage } from "../../lib/storage.ts";
import { userMessage } from "../../lib/userMessage.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const PlacesTab = ({
  groupId,
  groupName,
  livePositions,
}: {
  groupId: string;
  groupName: string;
  livePositions: readonly LiveMapPosition[];
}) => {
  const isFocused = useIsFocused();
  const { unit } = useUnits();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const { group } = useCachedGroup(groupId);
  const self = group?.members.find((member) => member.userId === userId);
  const canManage = self?.role === "OWNER" || self?.role === "ADMIN";
  const places = useQuery({
    ...groupPlacesQueryOptions(groupId, userId),
    subscribed: isFocused,
    refetchInterval: (query) =>
      query.state.data?.some((place) => !place.geometry) ? 60_000 : false,
  });
  const memberName = useMemberNames(groupId);
  const sharingQueryOptions = trpc.placeSharing.get.queryOptions({ groupId });
  const sharing = useQuery({ ...sharingQueryOptions, subscribed: isFocused });
  const setSharing = useMutation(trpc.placeSharing.set.mutationOptions());
  const memberDevices = useQuery({
    ...trpc.groupMembership.listMemberDevices.queryOptions({ groupId }),
    subscribed: isFocused,
  });
  const { data: registeredDevice } = useQuery(registeredDeviceQueryOptions(userId ?? ""));
  const thisDeviceName = memberDevices.data?.find(
    (device) => device.deviceId === registeredDevice?.deviceId,
  )?.name;
  const placeCount = places.data?.length ?? 0;
  useQuery({
    queryKey: ["placeCatchUp", groupId, userId],
    enabled: placeCount > 0,
    subscribed: isFocused,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: userId
      ? async () => {
          const moved = await catchUpGroupPlaces({ groupId, userId });
          if (moved > 0) {
            await queryClient.invalidateQueries({ queryKey: groupPlacesQueryKey(groupId) });
          }
          return moved;
        }
      : skipToken,
  });
  useEffect(() => {
    if (!isFocused || storage.getBoolean("places.notificationsAsked")) return;
    storage.set("places.notificationsAsked", true);
    void tryCatch(requestNotificationPermissions());
  }, [isFocused]);
  const atLimit = placeCount >= MAX_PLACES_PER_GROUP;
  const now = Date.now();

  if (places.isPending) {
    return <LoadingIndicator />;
  }

  if (places.isError && !places.data) {
    return (
      <View className="gap-3 rounded-3xl bg-card p-5">
        <Text className="text-foreground text-lg font-semibold">Couldn’t load places</Text>
        <Text className="text-tertiary">Check your connection and try again.</Text>
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          loading={places.isFetching}
          onPress={() => void places.refetch()}
        >
          <Text>Try again</Text>
        </Button>
      </View>
    );
  }

  const addPlaceButton = (label: string, className = "") =>
    atLimit ? (
      <Button
        size="sm"
        className={className}
        onPress={() =>
          Alert.alert(
            "Too many places",
            `A group can have up to ${MAX_PLACES_PER_GROUP} places. Delete one to add another.`,
          )
        }
      >
        <Icon as={PlusIcon} size={18} className="text-white" />
        <Text>{label}</Text>
      </Button>
    ) : (
      <Link href={{ pathname: "/place", params: { groupId } }} asChild>
        <Button size="sm" className={className}>
          <Icon as={PlusIcon} size={18} className="text-white" />
          <Text>{label}</Text>
        </Button>
      </Link>
    );

  const arrivalsOffNotice =
    sharing.data?.enabled === false ? (
      <View className="flex-row gap-3 rounded-2xl border border-warning-border bg-warning p-4">
        <Icon as={InfoIcon} size={20} className="mt-0.5 text-warning-text" />
        <Text className="flex-1 text-warning-text">
          {`Arrivals and departures are off on this ${thisDeviceNoun()}. ${groupName} sees “Arrivals off” for ${thisDeviceName ? `your ${thisDeviceName}` : `this ${thisDeviceNoun()}`}.`}
        </Text>
      </View>
    ) : null;

  const arrivalsSwitchCard = (
    <View className="flex-row items-center gap-4 rounded-3xl bg-card p-4">
      <View className="flex-1 gap-1">
        <Text className="text-foreground font-semibold">Share arrivals and departures</Text>
        <Text className="text-sm text-tertiary">
          {sharing.isError
            ? "Couldn’t load this setting."
            : `Only this ${thisDeviceNoun()}. When it arrives at or leaves a place, ${groupName} gets an alert.`}
        </Text>
      </View>
      {sharing.isError ? (
        <Button
          size="sm"
          variant="secondary"
          loading={sharing.isFetching}
          onPress={() => void sharing.refetch()}
        >
          <Text>Try again</Text>
        </Button>
      ) : (
        <Switch
          accessibilityLabel="Share arrivals and departures"
          disabled={sharing.data === undefined || setSharing.isPending}
          value={
            setSharing.isPending && setSharing.variables
              ? setSharing.variables.enabled
              : (sharing.data?.enabled ?? true)
          }
          onValueChange={async (enabled) => {
            const result = await tryCatch(setSharing.mutateAsync({ groupId, enabled }));
            if (result.error) {
              Alert.alert("Couldn’t change this setting", userMessage(result.error));
              return;
            }
            queryClient.setQueryData(
              sharingQueryOptions.queryKey,
              (current) => current && { ...current, enabled },
            );
            await queryClient.invalidateQueries({ queryKey: sharingQueryOptions.queryKey });
            if (userId) {
              const synced = await tryCatch(
                syncGroupPlaces({ groupId, quietPlaceIds: "all", sharingOff: !enabled, userId }),
              );
              if (!synced.data) markPlacesUnsynced({ groupId, userId });
            }
          }}
        />
      )}
    </View>
  );

  if (placeCount === 0) {
    return (
      <View className="gap-4">
        {arrivalsOffNotice}
        <View className="gap-4 rounded-3xl bg-card p-5">
          <View className="size-12 items-center justify-center rounded-full bg-primary-soft">
            <Icon as={MapPinIcon} size={20} className="text-primary-text" />
          </View>
          <Text className="text-foreground text-2xl font-bold">
            {canManage ? "Add your first place" : "No places yet"}
          </Text>
          <Text className="text-sm text-secondary">
            {canManage
              ? `Add places like home or school. When someone’s phone arrives or leaves, the rest of ${groupName} gets an alert.`
              : `Owners and admins can add places like home or school. When someone’s phone arrives or leaves, the rest of ${groupName} gets an alert.`}
          </Text>
          <Text className="text-sm text-secondary">
            Each phone shows the group’s places and can turn off its own arrivals and departures.
          </Text>
          {canManage ? addPlaceButton("Add place", "self-start") : null}
        </View>
        {sharing.data?.enabled === false || sharing.isError ? arrivalsSwitchCard : null}
      </View>
    );
  }

  return (
    <View className="gap-3">
      {arrivalsOffNotice}
      <View className="flex-row items-center justify-between gap-3">
        <Text variant="label">
          {placeCount} {placeCount === 1 ? "place" : "places"}
        </Text>
        <View className="flex-row items-center gap-2">
          <Link href={{ pathname: "/place-alerts", params: { groupId } }} asChild>
            <Button size="sm" variant="secondary" className="rounded-full">
              <Icon as={BellIcon} className="text-foreground size-4" />
              <Text>Alerts</Text>
            </Button>
          </Link>
          {canManage ? addPlaceButton("Add place", "rounded-full") : null}
        </View>
      </View>
      <View className={groupedListClassName}>
        {places.data.map((place, index) => {
          if (!place.geometry) {
            return (
              <View
                key={place.id}
                className={cn("flex-row items-center gap-4 p-4", groupedRowClassName(index))}
                style={groupedRowStyle(index, places.data.length)}
              >
                <View className={placeIconClassName}>
                  <Text className="text-2xl">{place.emoji}</Text>
                </View>
                <View className="flex-1 gap-1">
                  <Text className="text-foreground text-lg font-semibold">{place.name}</Text>
                  <View className="flex-row items-center gap-1">
                    <Icon as={HourglassIcon} size={14} className="text-tertiary" />
                    <Text className="flex-1 text-sm text-tertiary">
                      Syncing, this can take a few minutes
                    </Text>
                  </View>
                </View>
              </View>
            );
          }
          const here = peopleAtPlace({
            geometry: place.geometry,
            now,
            people: livePositions,
          }).map((person) => memberName(person.userId) ?? "Someone");
          return (
            <Link
              key={place.id}
              href={{ pathname: "/(tabs)/map", params: { placeId: place.id } }}
              asChild
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${place.name}, ${formatPlaceSize(place.geometry.radiusMeters, unit)}, ${describePeopleHere(here)}. Show on map`}
                className={cn(
                  "flex-row items-center gap-4 p-4 active:bg-container",
                  groupedRowClassName(index),
                )}
                style={groupedRowStyle(index, places.data.length)}
              >
                <View className={placeIconClassName}>
                  <Text className="text-2xl">{place.emoji}</Text>
                </View>
                <View className="flex-1 gap-0.5">
                  <Text className="text-foreground text-lg font-semibold">{place.name}</Text>
                  <Text className="text-sm text-tertiary">
                    {formatPlaceSize(place.geometry.radiusMeters, unit)}
                  </Text>
                  <Text
                    className={
                      here.length > 0
                        ? "text-sm font-semibold text-success"
                        : "text-sm text-tertiary"
                    }
                  >
                    {describePeopleHere(here)}
                  </Text>
                </View>
                {Platform.OS === "ios" ? (
                  <Icon as={ChevronRightIcon} size={20} className="text-border-strong" />
                ) : null}
              </Pressable>
            </Link>
          );
        })}
      </View>
      {arrivalsSwitchCard}
    </View>
  );
};

export default PlacesTab;

const placeIconClassName =
  Platform.OS === "ios"
    ? "size-12 items-center justify-center rounded-[12px] bg-secondary"
    : "size-12 items-center justify-center rounded-full bg-container";
