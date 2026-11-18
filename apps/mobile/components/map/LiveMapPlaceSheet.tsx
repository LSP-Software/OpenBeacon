import { Link } from "expo-router";
import { PencilIcon, Trash2Icon } from "lucide-react-native";
import { ScrollView, View } from "react-native";
import { usePlaceAlertMutes } from "../../hooks/usePlaceAlertMutes.ts";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { isEveryoneMuted } from "../../lib/placeAlertMutes.ts";
import { formatPlaceSize, type MapPlace } from "../../lib/places.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Switch } from "../ui/Switch.tsx";
import { Text } from "../ui/Text.tsx";
import { LiveMapBottomSheet } from "./LiveMapBottomSheet.tsx";

export const LiveMapPlaceSheet = ({
  here,
  onDelete,
  onDismiss,
  onHeightChange,
  place,
}: {
  here: readonly LiveMapMarker[];
  onDelete: () => void;
  onDismiss: () => void;
  onHeightChange: (height: number) => void;
  place: MapPlace;
}) => (
  <LiveMapBottomSheet
    accessibilityLabel={`${place.name}, ${place.groupName}`}
    header={
      <View className="flex-row items-center gap-4 pb-2">
        <View className="size-14 items-center justify-center rounded-2xl bg-primary/10">
          <Text className="text-3xl">{place.emoji}</Text>
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-foreground text-2xl font-bold" numberOfLines={1}>
            {place.name}
          </Text>
          <Text className="text-tertiary" numberOfLines={1}>
            {place.groupName} · {formatPlaceSize(place.radiusMeters)}
          </Text>
        </View>
      </View>
    }
    onDismiss={onDismiss}
    onHeightChange={onHeightChange}
  >
    <Text className="mt-2 text-xs font-bold uppercase tracking-wider text-tertiary">Here now</Text>
    {here.length === 0 ? (
      <Text className="py-2 text-tertiary">Nobody here now</Text>
    ) : (
      <ScrollView style={{ maxHeight: 180 }} bounces={false} overScrollMode="never">
        {here.map((marker) => (
          <View key={marker.userId} className="flex-row items-center gap-3 py-2">
            <View className="size-10 items-center justify-center rounded-full bg-primary">
              <Text className="font-bold text-white">{marker.initials}</Text>
            </View>
            <Text className="text-foreground text-lg" numberOfLines={1}>
              {marker.isSelf ? `${marker.name} (you)` : marker.name}
            </Text>
          </View>
        ))}
      </ScrollView>
    )}
    <MuteEveryoneRow groupId={place.groupId} placeId={place.id} placeName={place.name} />
    {place.canManage ? (
      <View className="mt-1 flex-row gap-3 pt-2">
        <Link
          href={{ pathname: "/place", params: { groupId: place.groupId, placeId: place.id } }}
          asChild
        >
          <Button variant="secondary" className="flex-1">
            <Icon as={PencilIcon} size={18} className="text-primary-text" />
            <Text>Edit</Text>
          </Button>
        </Link>
        <Button variant="secondary" className="flex-1 border-destructive" onPress={onDelete}>
          <Icon as={Trash2Icon} size={18} className="text-destructive-text" />
          <Text className="text-destructive-text">Delete</Text>
        </Button>
      </View>
    ) : null}
  </LiveMapBottomSheet>
);

const MuteEveryoneRow = ({
  groupId,
  placeId,
  placeName,
}: {
  groupId: string;
  placeId: string;
  placeName: string;
}) => {
  const { mutes, setMute } = usePlaceAlertMutes(groupId);
  return (
    <View className="mt-3 flex-row items-center gap-4 border-t border-border py-4">
      <View className="flex-1 gap-0.5">
        <Text className="text-foreground text-base font-semibold">Mute everyone here</Text>
        <Text className="text-tertiary text-sm">
          {mutes.isError ? "Couldn’t load this setting." : "Only changes your alerts"}
        </Text>
      </View>
      {mutes.isError ? (
        <Button
          size="sm"
          variant="secondary"
          loading={mutes.isFetching}
          onPress={() => void mutes.refetch()}
        >
          <Text>Try again</Text>
        </Button>
      ) : (
        <Switch
          accessibilityLabel={`Mute everyone at ${placeName}`}
          disabled={mutes.data === undefined}
          value={mutes.data ? isEveryoneMuted(mutes.data.mutes, placeId) : false}
          onValueChange={(muted) => setMute({ placeId, mutedUserId: null, muted })}
        />
      )}
    </View>
  );
};
