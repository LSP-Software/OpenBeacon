import { Link } from "expo-router";
import { View } from "react-native";
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

  return (
    <LiveMapBottomSheet
      accessibilityLabel={`${person.name} details`}
      onDismiss={onDismiss}
      onHeightChange={onHeightChange}
      header={
        <>
          <View className="flex-row items-center gap-3">
            <Avatar alt={person.name} className="size-12" style={{ opacity: 0.45 }}>
              {person.image ? <AvatarImage source={{ uri: person.image }} /> : null}
              <AvatarFallback>
                <Text className="font-bold">{person.initials}</Text>
              </AvatarFallback>
            </Avatar>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-foreground text-xl font-bold">{person.name}</Text>
              <Text className="text-muted text-sm">
                {unreadable ? "Can’t read their location" : "Location unknown"}
              </Text>
            </View>
          </View>
          {unreadable ? (
            <View className="mt-3 gap-2 rounded-xl border border-destructive p-3">
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
              >
                <Text className="font-semibold text-destructive">Open {unreadable.groupName}</Text>
              </Link>
            </View>
          ) : (
            <View className="mt-3 rounded-xl bg-background p-3">
              <Text className="text-sm">
                This phone hasn’t received a location from {person.name}. They might have location
                sharing turned off, or not have opened OpenBeacon since joining.
              </Text>
            </View>
          )}
          <Text className="text-muted-foreground mt-2 text-sm">
            In {person.groupNames.join(", ")}
          </Text>
        </>
      }
    />
  );
};
