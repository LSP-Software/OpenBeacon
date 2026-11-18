import { Link } from "expo-router";
import { View } from "react-native";
import { Button } from "./ui/Button.tsx";
import { Text } from "./ui/Text.tsx";

export const SeatHoldBanner = ({
  groups,
  linkToGroup,
  userId,
}: {
  groups: readonly {
    id: string;
    members: readonly { name: string; userId: string }[];
    name: string;
    onHold: boolean;
    ownerId: string;
  }[];
  linkToGroup: boolean;
  userId: string;
}) => (
  <>
    {groups
      .filter((group) => group.onHold)
      .map((group) => {
        const owner = group.members.find((member) => member.userId === group.ownerId)?.name;
        return (
          <View
            key={group.id}
            className="mb-2 gap-2 rounded-xl border border-amber-600 dark:border-amber-400 bg-card p-4"
          >
            <Text className="font-semibold text-amber-700 dark:text-amber-400">
              This phone is on hold in {group.name}
            </Text>
            <Text>
              {group.ownerId === userId
                ? `You don’t have a seat for this phone, so it isn’t sharing your location with ${group.name} and can’t see anyone in it. Add seats or remove someone from your groups.`
                : `${owner ?? "The owner"} has no free seat for this phone, so it isn’t sharing your location with ${group.name} and can’t see anyone in it. Ask ${owner ?? "the owner"} to add seats, remove another of your phones, or leave the group.`}{" "}
              Sharing starts again on its own when a seat is free.
            </Text>
            <View className="flex-row flex-wrap items-center gap-3">
              {linkToGroup ? (
                <Link
                  href={{ pathname: "/(tabs)/groups/[groupId]", params: { groupId: group.id } }}
                  asChild
                >
                  <Button size="sm">
                    <Text>Open {group.name}</Text>
                  </Button>
                </Link>
              ) : null}
              {group.ownerId === userId ? null : (
                <Link href="/account/devices" asChild>
                  <Button size="sm" variant="secondary">
                    <Text>Your phones</Text>
                  </Button>
                </Link>
              )}
            </View>
          </View>
        );
      })}
  </>
);
