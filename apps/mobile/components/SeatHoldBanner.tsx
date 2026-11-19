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
            className="mb-2 gap-2 rounded-2xl border border-warning-accent bg-card p-4"
          >
            <Text className="font-semibold text-warning-text">
              This phone is on hold in {group.name}
            </Text>
            <Text>
              {group.ownerId === userId
                ? `You don’t have room for everyone in your groups, so this phone isn’t sharing your location with ${group.name} and can’t see anyone in it. Remove someone from your groups to make room.`
                : `${owner ?? "The owner"} has no room for you in their groups, so this phone isn’t sharing your location with ${group.name} and can’t see anyone in it. Ask ${owner ?? "the owner"} to make room, or leave the group.`}{" "}
              Sharing starts again on its own when there’s room.
            </Text>
            {linkToGroup || group.ownerId === userId ? (
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
                {group.ownerId === userId ? (
                  <Link href="/account/usage" asChild>
                    <Button size="sm" variant="secondary">
                      <Text>See usage</Text>
                    </Button>
                  </Link>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
  </>
);
