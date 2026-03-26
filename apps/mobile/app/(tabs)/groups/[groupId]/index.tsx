import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { MoreVerticalIcon } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../../../components/headers/BackButton";
import { LoadingIndicator } from "../../../../components/LoadingIndicator";
import { RefreshablePage } from "../../../../components/RefreshablePage";
import { Avatar, AvatarFallback, AvatarImage } from "../../../../components/ui/Avatar";
import { Icon } from "../../../../components/ui/Icon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../components/ui/Tabs";
import { Text } from "../../../../components/ui/Text";
import { type RouterOutputs, trpc } from "../../../../lib/api";
import { cn } from "../../../../lib/cn";
import HistoryTab from "./HistoryTab";
import MembersTab from "./MembersTab";
import SettingsTab from "./SettingsTab";

const GROUP_TABS = [
  {
    value: "members",
    label: "Members",
    content: MembersTab,
  },
  {
    value: "history",
    label: "History",
    content: HistoryTab,
  },
  {
    value: "settings",
    label: "Settings",
    content: SettingsTab,
  },
] as const;

type GroupTabValue = (typeof GROUP_TABS)[number]["value"];
const isGroupTabValue = (value: string): value is GroupTabValue =>
  GROUP_TABS.some((tab) => tab.value === value);

export default function GroupScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const [value, setValue] = useState<GroupTabValue>("members");

  const onValueChange = (nextValue: string) => {
    if (isGroupTabValue(nextValue)) {
      setValue(nextValue);
    }
  };

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
      <SafeAreaView edges={["top", "bottom"]} className="flex-1 bg-background px-4 py-5 gap-4">
        <GroupHeader group={group} />
        <Tabs value={value} onValueChange={onValueChange}>
          <TabsList className="-mx-4 px-4 w-auto justify-between bg-transparent rounded-none p-0 h-auto border-0 border-y border-border">
            {GROUP_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className={cn(
                  "flex-1 rounded-none border-0 border-b-2 border-transparent px-0 py-2 h-auto bg-transparent",
                  value === tab.value && "border-primary",
                )}
              >
                <Text
                  className={cn(
                    "text-muted-foreground text-lg",
                    value === tab.value && "text-primary",
                  )}
                >
                  {tab.label}
                </Text>
              </TabsTrigger>
            ))}
          </TabsList>
          {GROUP_TABS.map((tab) => (
            <TabsContent key={tab.value} value={tab.value}>
              <tab.content groupId={groupId} />
            </TabsContent>
          ))}
        </Tabs>
      </SafeAreaView>
    </RefreshablePage>
  );
}

interface GroupHeaderProps {
  group: NonNullable<RouterOutputs["groupMembership"]["get"]>;
}

const GroupHeader = ({ group }: GroupHeaderProps) => {
  return (
    <>
      <View className="flex-row gap-4 items-center justify-between">
        <BackButton />
        <Icon as={MoreVerticalIcon} className="text-primary size-6" />
      </View>
      <View className="flex-row items-center gap-4">
        <Avatar alt="Group image">
          <AvatarImage source={{ uri: group.image ?? "" }} />
          <AvatarFallback>
            <Text className="font-bold">
              {(group.name.charAt(0) + group.name.charAt(1)).toUpperCase()}
            </Text>
          </AvatarFallback>
        </Avatar>
        <Text className="text-foreground font-bold text-3xl">{group.name}</Text>
      </View>
    </>
  );
};
