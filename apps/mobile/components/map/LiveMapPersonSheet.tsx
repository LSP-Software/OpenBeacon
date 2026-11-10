import { Link } from "expo-router";
import { Pressable, View } from "react-native";
import { useTimeSince } from "../../hooks/useTimeSince.ts";
import { getBatteryVisual } from "../../lib/batteryVisual.ts";
import { locationStaleAt } from "../../lib/locationStaleAt.ts";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/Avatar.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";
import { LiveMapBottomSheet } from "./LiveMapBottomSheet.tsx";

export const LiveMapPersonSheet = ({
  battery,
  image,
  initials,
  isSelf = false,
  name,
  onDismiss,
  onHeightChange,
  otherSharedGroupNames,
  timestamp,
  unreadableGroup,
}: {
  battery: { charging: boolean; level: number } | null;
  image: string | null;
  initials: string;
  isSelf?: boolean;
  name: string;
  onDismiss: () => void;
  onHeightChange?: (height: number) => void;
  otherSharedGroupNames: readonly string[];
  timestamp: string | null;
  unreadableGroup?: { id: string; name: string } | undefined;
}) => {
  const updatedAge = useTimeSince(timestamp);
  const isOutOfDate = !isSelf && timestamp !== null && Date.now() >= locationStaleAt(timestamp);
  const batteryVisual = battery
    ? getBatteryVisual({
        batteryLevel: battery.level,
        charging: battery.charging,
      })
    : null;

  return (
    <LiveMapBottomSheet
      accessibilityLabel={`${name} details`}
      onDismiss={onDismiss}
      onHeightChange={onHeightChange}
      header={
        <>
          <View className="flex-row items-center gap-3">
            <Avatar alt={name} className="size-12">
              {image ? <AvatarImage source={{ uri: image }} /> : null}
              <AvatarFallback>
                <Text className="font-bold">{initials}</Text>
              </AvatarFallback>
            </Avatar>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-foreground text-xl font-bold">{name}</Text>
              <Text className="text-muted text-sm">
                {updatedAge === null
                  ? "No location sent yet"
                  : `${isSelf ? "Location sent" : "Updated"} ${updatedAge}`}
              </Text>
            </View>
          </View>
          {isOutOfDate && !unreadableGroup ? (
            <View className="mt-3 rounded-xl bg-background p-3">
              <Text className="text-sm">
                {name}’s phone hasn’t sent a location since then. It might be offline, out of
                battery, or have location turned off.
              </Text>
            </View>
          ) : null}
          {battery && batteryVisual ? (
            <View className="mt-3 flex-row items-center gap-2">
              <Icon as={batteryVisual.icon} size={20} className={batteryVisual.colorClass} />
              <Text className={`${batteryVisual.colorClass} text-sm`}>
                Battery: {battery.level}%
              </Text>
            </View>
          ) : null}
          {otherSharedGroupNames.length > 0 ? (
            <Text className="text-muted-foreground mt-2 text-sm">
              Also in {otherSharedGroupNames.join(", ")}
            </Text>
          ) : null}
        </>
      }
    >
      {unreadableGroup ? (
        <View className="mt-3 gap-2 rounded-xl border border-destructive p-3">
          <Text className="text-sm">
            {name}’s newer locations were encrypted with a key this phone doesn’t have, so this is
            the last location it can read.
          </Text>
          <Link
            href={{
              pathname: "/(tabs)/groups/[groupId]",
              params: { groupId: unreadableGroup.id },
            }}
            asChild
          >
            <Pressable accessibilityRole="link" className="min-h-11 justify-center self-start">
              <Text className="font-semibold text-destructive">Open {unreadableGroup.name}</Text>
            </Pressable>
          </Link>
        </View>
      ) : undefined}
    </LiveMapBottomSheet>
  );
};
