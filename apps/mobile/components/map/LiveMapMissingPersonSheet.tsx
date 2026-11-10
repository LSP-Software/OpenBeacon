import { Link } from "expo-router";
import { Pressable, View } from "react-native";
import type { MapPerson, MapUnreadablePerson } from "../../lib/mapPeopleTypes.ts";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/Avatar.tsx";
import { Text } from "../ui/Text.tsx";
import { LiveMapBottomSheet } from "./LiveMapBottomSheet.tsx";

export const LiveMapMissingPersonSheet = ({
  onDismiss,
  onHeightChange,
  person,
}: {
  onDismiss: () => void;
  onHeightChange: (height: number) => void;
  person: MapPerson | MapUnreadablePerson;
}) => {
  const unreadable = "reason" in person ? person : null;
  const name = person.isSelf ? "You" : person.name;

  return (
    <LiveMapBottomSheet
      accessibilityLabel={`${name} details`}
      onDismiss={onDismiss}
      onHeightChange={onHeightChange}
      header={
        <View className="flex-row items-center gap-3">
          <Avatar alt={person.name} className="size-12" style={{ opacity: 0.45 }}>
            {person.image ? <AvatarImage source={{ uri: person.image }} /> : null}
            <AvatarFallback className="bg-neutral-500">
              <Text className="font-bold">{person.initials}</Text>
            </AvatarFallback>
          </Avatar>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-foreground text-xl font-bold">{name}</Text>
            <Text className="text-muted dark:text-muted-foreground text-sm">
              {unreadable ? "Can’t read their location" : "Location unknown"}
            </Text>
          </View>
        </View>
      }
    >
      {unreadable ? (
        <View className="mt-3 rounded-xl border border-destructive px-3 pt-3 pb-1">
          <Text className="text-sm">
            {unreadable.reason === "groupKey"
              ? `This phone doesn’t have the encryption key for ${unreadable.groupName}, so it can’t read locations shared there.`
              : `${person.name}’s latest location was encrypted with a key this phone doesn’t have.`}
          </Text>
          <Link
            href={{
              pathname: "/(tabs)/groups/[groupId]",
              params: { groupId: unreadable.groupId },
            }}
            asChild
          >
            <Pressable accessibilityRole="link" className="min-h-11 justify-center self-start">
              <Text className="font-semibold text-destructive">Open {unreadable.groupName}</Text>
            </Pressable>
          </Link>
        </View>
      ) : (
        <View className="mt-3 rounded-xl bg-background p-3">
          <Text className="text-sm">
            {person.isSelf
              ? "Your location hasn’t been shared from this phone yet. Check OpenBeacon has location permission and background location turned on."
              : `This phone hasn’t received a location from ${person.name}. They might have location sharing turned off, or not have opened OpenBeacon since joining.`}
          </Text>
        </View>
      )}
      <Text className="text-muted dark:text-muted-foreground mt-2 text-sm">
        In {person.groupNames.join(", ")}
      </Text>
    </LiveMapBottomSheet>
  );
};
