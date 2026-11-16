import { useQuery } from "@tanstack/react-query";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { LocationSharingCard } from "../../components/LocationSharingCard.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/Avatar.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { initials } from "../../lib/initials.ts";

const formatDate = (date: Date) =>
  date.toLocaleDateString(undefined, { day: "numeric", month: "short" });

const endedReason = {
  theyLeft: "They left the group",
  theyWereRemoved: "They were removed from the group",
  youLeft: "You left the group",
  youWereRemoved: "You were removed from the group",
} as const;

const Person = ({
  image,
  name,
  details,
  last,
}: {
  image: string | null;
  name: string;
  details: string[];
  last: boolean;
}) => (
  <View
    accessible
    className={cn("flex-row items-center gap-4 px-5 py-4", !last && "border-b border-border/50")}
  >
    <Avatar alt={`${name}'s profile picture`} className="size-11">
      <AvatarImage source={{ uri: image ?? "" }} />
      <AvatarFallback>
        <Text className="text-sm font-bold">{initials(name)}</Text>
      </AvatarFallback>
    </Avatar>
    <View className="flex-1 gap-1">
      <Text className="text-foreground text-base font-medium">{name}</Text>
      {details.map((detail) => (
        <Text key={detail} className="text-muted-foreground text-sm">
          {detail}
        </Text>
      ))}
    </View>
  </View>
);

const WhoCanSeeMeScreen = () => {
  const viewers = useQuery(trpc.account.viewers.queryOptions());

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          <BackButton />
          <Text className="text-foreground text-2xl font-bold">Who can see me</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      {viewers.isPending ? (
        <LoadingIndicator />
      ) : viewers.isError ? (
        <View className="flex-1 items-center justify-center gap-4 px-6">
          <Text className="text-muted-foreground text-center">
            We couldn’t load who can see you. Check your connection and try again.
          </Text>
          <Button variant="outline" onPress={() => viewers.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-4 px-6 py-6 pb-32"
          showsVerticalScrollIndicator={false}
        >
          <LocationSharingCard />

          <Text className="text-foreground text-lg font-semibold">Can see you now</Text>
          <Text className="text-muted-foreground text-base leading-6">
            Everyone in a group with you can see your location while you’re sharing it.
          </Text>
          {viewers.data.current.length === 0 ? (
            <Text className="text-muted-foreground text-base">
              No one. You’re not in a group with anyone else.
            </Text>
          ) : (
            <View className="overflow-hidden rounded-3xl border border-border bg-card">
              {viewers.data.current.map((viewer, index) => (
                <Person
                  key={viewer.userId}
                  image={viewer.image}
                  name={viewer.name}
                  details={viewer.groups.map(
                    (group) => `${group.name} · since ${formatDate(group.since)}`,
                  )}
                  last={index === viewers.data.current.length - 1}
                />
              ))}
            </View>
          )}

          <Text className="text-foreground text-lg font-semibold">Could see you recently</Text>
          <Text className="text-muted-foreground text-base leading-6">
            People who stopped being in a group with you since {formatDate(viewers.data.since)}.
            They can’t see where you go now, but they may have kept what they saw before.
          </Text>
          {viewers.data.past.length === 0 ? (
            <Text className="text-muted-foreground text-base">No one.</Text>
          ) : (
            <View className="overflow-hidden rounded-3xl border border-border bg-card">
              {viewers.data.past.map((viewer, index) => (
                <Person
                  key={`${viewer.groupId}-${viewer.userId}-${viewer.to.getTime()}`}
                  image={viewer.image}
                  name={viewer.name}
                  details={[
                    `${viewer.groupName} · ${viewer.from ? `${formatDate(viewer.from)} to ${formatDate(viewer.to)}` : `until ${formatDate(viewer.to)}`}`,
                    endedReason[viewer.reason],
                  ]}
                  last={index === viewers.data.past.length - 1}
                />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
};

export default WhoCanSeeMeScreen;
