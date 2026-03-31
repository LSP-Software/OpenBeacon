import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import {
  Clock3Icon,
  MoreVerticalIcon,
  SlidersHorizontalIcon,
  UsersIcon,
} from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../../../components/headers/BackButton.tsx";
import { GroupImage } from "../../../../components/image/GroupImage.tsx";
import { LoadingIndicator } from "../../../../components/LoadingIndicator.tsx";
import { RefreshablePage } from "../../../../components/RefreshablePage.tsx";
import { Icon } from "../../../../components/ui/Icon.tsx";
import { SwipeTabs, type SwipeTabsItem } from "../../../../components/ui/SwipeTabs.tsx";
import { Text } from "../../../../components/ui/Text.tsx";
import { type RouterOutputs, trpc } from "../../../../lib/api.ts";
import HistoryTab from "./HistoryTab.tsx";
import MembersTab from "./MembersTab.tsx";
import SettingsTab from "./SettingsTab.tsx";

type GroupTabValue = "members" | "history" | "settings";

const GROUP_TABS: readonly SwipeTabsItem<GroupTabValue>[] = [
  {
    value: "members",
    label: "Members",
    icon: UsersIcon,
  },
  {
    value: "history",
    label: "History",
    icon: Clock3Icon,
  },
  {
    value: "settings",
    label: "Settings",
    icon: SlidersHorizontalIcon,
  },
] as const;

export default function GroupScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const [value, setValue] = useState<GroupTabValue>("members");
  const { data: group, isFetching: isFetchingGroup } = useQuery(
    trpc.groupMembership.get.queryOptions({ groupId }),
  );

  if (isFetchingGroup) {
    return <LoadingIndicator />;
  }

  if (!group) {
    return <Text>Group not found</Text>;
  }

  return (
    <RefreshablePage>
      <SafeAreaView edges={["top", "bottom"]} className="flex-1 bg-background px-4 py-5">
        <View className="overflow-hidden rounded-2xl border border-border bg-card px-5 py-5">
          <View className="gap-5">
            <GroupHeader group={group} />
            <SwipeTabs
              ariaLabel="Group sections"
              tabs={GROUP_TABS}
              value={value}
              onValueChange={setValue}
              renderScene={(tabValue) => {
                if (tabValue === "members") {
                  return <MembersTab groupId={groupId} />;
                }

                if (tabValue === "history") {
                  return <HistoryTab />;
                }

                return <SettingsTab groupName={group.name} />;
              }}
            />
          </View>
        </View>
      </SafeAreaView>
    </RefreshablePage>
  );
}

interface GroupHeaderProps {
  group: NonNullable<RouterOutputs["groupMembership"]["get"]>;
}

const GroupHeader = ({ group }: GroupHeaderProps) => {
  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between gap-4">
        <BackButton />
        <View className="size-11 items-center justify-center rounded-full border border-border bg-background">
          <Icon as={MoreVerticalIcon} className="text-primary size-5" />
        </View>
      </View>
      <View className="flex-row items-center gap-4">
        <GroupImage groupId={group.id} imageUrl={group.image ?? null} size="md" />
        <View className="flex-1">
          <Text className="text-foreground text-3xl font-bold">{group.name}</Text>
        </View>
      </View>
    </View>
  );
};
