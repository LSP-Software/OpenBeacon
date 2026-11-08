import { useIsFocused } from "@react-navigation/native";
import { tryCatch } from "@openbeacon/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { Clock3Icon, SlidersHorizontalIcon, UsersIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../../../components/headers/BackButton.tsx";
import { GroupImage } from "../../../../components/image/GroupImage.tsx";
import { LoadingIndicator } from "../../../../components/LoadingIndicator.tsx";
import { RefreshablePage } from "../../../../components/RefreshablePage.tsx";
import { Button } from "../../../../components/ui/Button.tsx";
import { SwipeTabs, type SwipeTabsItem } from "../../../../components/ui/SwipeTabs.tsx";
import { Text } from "../../../../components/ui/Text.tsx";
import { useGroupKeyHistoryAccess } from "../../../../hooks/useGroupKeyAccess.ts";
import { useHeldHistoryKeyVersions } from "../../../../hooks/useHeldHistoryKeyVersions.ts";
import { type RouterOutputs, trpc } from "../../../../lib/api.ts";
import { authClient } from "../../../../lib/auth-client.ts";
import { storage } from "../../../../lib/storage.ts";
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

const GroupScreen = () => {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const { data: session } = authClient.useSession();
  const [keyAccess] = useGroupKeyHistoryAccess([groupId], session?.user.id);
  const [value, setValue] = useState<GroupTabValue>("members");
  const historyWarningKey = `recovery.historyWarningDismissedFrom.${session?.user.id}.${groupId}`;
  const [historyWarningDismissedFrom, setHistoryWarningDismissedFrom] = useState<number | null>(
    null,
  );
  const recoveryStatus = useQuery(trpc.accountRecovery.status.queryOptions());
  const currentHistoryKeyVersion = recoveryStatus.data?.currentHistoryKey?.version ?? 0;
  const heldHistoryKeyVersions = useHeldHistoryKeyVersions(
    session?.user.id,
    recoveryStatus.data?.currentHistoryKey ?? undefined,
  );
  const {
    data: group,
    error,
    isPending: isFetchingGroup,
  } = useQuery({
    ...trpc.groupMembership.get.queryOptions({ groupId }),
    refetchInterval: 10_000,
  });
  const historyPartialFrom =
    keyAccess?.data && keyAccess.data.history !== "complete"
      ? keyAccess.data.history.partialFrom
      : null;
  const dismissedHistoryFrom =
    historyWarningDismissedFrom ?? storage.getNumber(historyWarningKey) ?? null;
  const showHistoryWarning =
    historyPartialFrom !== null &&
    (dismissedHistoryFrom === null || historyPartialFrom.getTime() < dismissedHistoryFrom);
  const canRestoreRecoveryPhrase =
    !!recoveryStatus.data?.recoveryKey &&
    !!heldHistoryKeyVersions.data &&
    !heldHistoryKeyVersions.data.includes(currentHistoryKeyVersion);

  useEffect(() => {
    if (!isFocused || error?.data?.code !== "FORBIDDEN") return;
    let active = true;
    void (async () => {
      const result = await tryCatch(
        queryClient.fetchQuery({
          ...trpc.groupMembership.list.queryOptions(),
          staleTime: 0,
        }),
      );
      if (active && !result.error && !result.data.some((item) => item.id === groupId)) {
        router.replace("/(tabs)/groups/list");
      }
    })();
    return () => {
      active = false;
    };
  }, [error, groupId, isFocused, queryClient, router]);

  if (isFetchingGroup) {
    return <LoadingIndicator />;
  }

  if (!group) {
    return <Text>Group not found</Text>;
  }

  return (
    <RefreshablePage>
      <SafeAreaView edges={["top", "bottom"]} className="flex-1 bg-background px-4 pt-5 pb-32">
        <View className="overflow-hidden rounded-2xl border border-border bg-card px-5 py-5">
          <View className="gap-5">
            <GroupHeader group={group} />
            {keyAccess?.data?.current === "missing" && (
              <View className="gap-2 rounded-xl border border-destructive bg-card p-4">
                <Text className="font-semibold text-destructive">
                  This phone can’t access this group’s current encryption key
                </Text>
                <Text>Current group locations may be unavailable on this phone.</Text>
              </View>
            )}
            {historyPartialFrom !== null && showHistoryWarning && (
              <View className="gap-2 rounded-xl border border-amber-600 dark:border-amber-400 bg-card p-4">
                <Text className="font-semibold text-amber-700 dark:text-amber-400">
                  Some location history isn’t available on this phone
                </Text>
                <Text>
                  History from before{" "}
                  {historyPartialFrom.toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })}{" "}
                  can’t be read on this phone.
                </Text>
                <View className="flex-row flex-wrap gap-3">
                  {canRestoreRecoveryPhrase && (
                    <Link href="/account/recovery-restore" asChild>
                      <Button size="sm">
                        <Text>Restore recovery phrase</Text>
                      </Button>
                    </Link>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onPress={() => {
                      storage.set(historyWarningKey, historyPartialFrom.getTime());
                      setHistoryWarningDismissedFrom(historyPartialFrom.getTime());
                    }}
                  >
                    <Text>Dismiss</Text>
                  </Button>
                </View>
              </View>
            )}
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

                return <SettingsTab groupId={groupId} />;
              }}
            />
          </View>
        </View>
      </SafeAreaView>
    </RefreshablePage>
  );
};

const GroupHeader = ({
  group,
}: {
  group: NonNullable<RouterOutputs["groupMembership"]["get"]>;
}) => {
  const canEditGroupImage = group.groupMembers.some(
    (member) => member.role === "OWNER" || member.role === "ADMIN",
  );

  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between gap-4">
        <BackButton />
      </View>
      <View className="flex-row items-center gap-4">
        <GroupImage
          groupId={group.id}
          imageUrl={group.image ?? null}
          size="md"
          editable={canEditGroupImage}
        />
        <View className="flex-1">
          <Text className="text-foreground text-3xl font-bold">{group.name}</Text>
        </View>
      </View>
    </View>
  );
};

export default GroupScreen;
