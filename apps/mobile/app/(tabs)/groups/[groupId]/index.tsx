import { useIsFocused } from "@react-navigation/native";
import { tryCatch } from "@openbeacon/shared";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { ClockIcon, MapPinIcon, SlidersHorizontalIcon, UsersIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { ScreenHeader } from "../../../../components/headers/ScreenHeader.tsx";
import { LoadingIndicator } from "../../../../components/LoadingIndicator.tsx";
import { RefreshablePage } from "../../../../components/RefreshablePage.tsx";
import { Button } from "../../../../components/ui/Button.tsx";
import { SwipeTabs, type SwipeTabsItem } from "../../../../components/ui/SwipeTabs.tsx";
import { Text } from "../../../../components/ui/Text.tsx";
import { useGroupKeyHistoryAccess } from "../../../../hooks/useGroupKeyAccess.ts";
import { useCachedGroup } from "../../../../hooks/useCachedGroup.ts";
import { useHeldHistoryKeyVersions } from "../../../../hooks/useHeldHistoryKeyVersions.ts";
import { useLiveTrackingPositions } from "../../../../hooks/useLiveTrackingPositions.ts";
import { useUnseenGroupHistory } from "../../../../hooks/useUnseenGroupHistory.ts";
import { trpc } from "../../../../lib/api.ts";
import { authClient } from "../../../../lib/auth-client.ts";
import { rotateGroupEpochIfRequired } from "../../../../lib/groupEncryption.ts";
import { catchUpGroupImageKeys } from "../../../../lib/imageKeyCatchUp.ts";
import { storage } from "../../../../lib/storage.ts";
import HistoryTab from "../../../../components/groups/HistoryTab.tsx";
import MembersTab from "../../../../components/groups/MembersTab.tsx";
import PlacesTab from "../../../../components/groups/PlacesTab.tsx";
import SettingsTab from "../../../../components/groups/SettingsTab.tsx";
import { thisDeviceNoun } from "../../../../lib/thisDeviceNoun.ts";

type GroupTabValue = "members" | "places" | "history" | "settings";

const GROUP_TABS: readonly SwipeTabsItem<GroupTabValue>[] = [
  { value: "members", label: "Members", icon: UsersIcon },
  { value: "places", label: "Places", icon: MapPinIcon },
  { value: "history", label: "History", icon: ClockIcon },
  { value: "settings", label: "Settings", icon: SlidersHorizontalIcon },
] as const;

const GroupScreen = () => {
  const { groupId, tab } = useLocalSearchParams<{ groupId: string; tab?: string }>();
  return (
    <GroupBody
      key={`${groupId}:${tab ?? ""}`}
      groupId={groupId}
      initialTab={GROUP_TABS.find((item) => item.value === tab)?.value ?? "members"}
    />
  );
};

const GroupBody = ({ groupId, initialTab }: { groupId: string; initialTab: GroupTabValue }) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const { data: session } = authClient.useSession();
  const [keyAccess] = useGroupKeyHistoryAccess([groupId], session?.user.id);
  const [value, setValue] = useState<GroupTabValue>(initialTab);
  const historyWarningKey = `recovery.historyWarningDismissedFrom.${session?.user.id}.${groupId}`;
  const [historyWarningDismissedFrom, setHistoryWarningDismissedFrom] = useState<number | null>(
    null,
  );
  const recoveryStatus = useQuery({
    ...trpc.accountRecovery.status.queryOptions(),
    subscribed: isFocused,
  });
  const currentHistoryKeyVersion = recoveryStatus.data?.currentHistoryKey?.version ?? 0;
  const heldHistoryKeyVersions = useHeldHistoryKeyVersions(
    session?.user.id,
    recoveryStatus.data?.currentHistoryKey ?? undefined,
  );
  const { group, isPending, isMissing } = useCachedGroup(groupId);
  const userId = session?.user.id;
  const imageKeyEpochs = group
    ? [
        group.latestEpochId ?? null,
        group.imageKey?.epochId ?? null,
        ...group.members.map((member) => [member.id, member.imageKey?.epochId ?? null]),
      ]
    : [];
  useQuery({
    queryKey: ["imageKeyCatchUp", groupId, userId, imageKeyEpochs],
    enabled: Boolean(group && (group.imageKey || group.members.some((member) => member.image))),
    subscribed: isFocused,
    staleTime: 15 * 60_000,
    gcTime: 15 * 60_000,
    retry: false,
    queryFn: userId
      ? async () => {
          await tryCatch(rotateGroupEpochIfRequired(groupId));
          const moved = await catchUpGroupImageKeys({ groupId, userId });
          if (moved > 0) {
            await queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() });
          }
          return moved;
        }
      : skipToken,
  });
  const live = useLiveTrackingPositions({ groupId });
  const history = useUnseenGroupHistory();
  const historyLatestAt =
    history.latest?.find((item) => item.groupId === groupId)?.latestAt ?? null;
  const [verifyFailedFor, setVerifyFailedFor] = useState<string | null>(null);
  const [verifyAttempt, setVerifyAttempt] = useState(0);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: verifyAttempt reruns the check when the user taps retry
  useEffect(() => {
    if (!isFocused || !isMissing) return;
    let active = true;
    void (async () => {
      const result = await tryCatch(
        queryClient.fetchQuery({
          ...trpc.groupMembership.list.queryOptions(),
          staleTime: 0,
        }),
      );
      if (!active) return;
      if (result.error) {
        setVerifyFailedFor(groupId);
        return;
      }
      if (!result.data.some((item) => item.id === groupId)) {
        router.dismissTo("/(tabs)/groups/list");
      }
    })();
    return () => {
      active = false;
    };
  }, [groupId, isFocused, isMissing, queryClient, router, verifyAttempt]);

  useEffect(() => {
    if (!isFocused || value !== "history" || !history.userId) return;
    void queryClient.invalidateQueries(
      { queryKey: ["groupHistory", groupId] },
      { cancelRefetch: false },
    );
  }, [groupId, history.userId, historyLatestAt, isFocused, queryClient, value]);

  if (isPending || (isMissing && verifyFailedFor !== groupId)) {
    return (
      <>
        <ScreenHeader title="" fallback="/(tabs)/groups/list" />
        <LoadingIndicator />
      </>
    );
  }

  if (!group) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-6">
        <ScreenHeader title="Group" fallback="/(tabs)/groups/list" />
        <Text className="text-tertiary text-center">
          We couldn’t load this group. Check your connection and try again.
        </Text>
        <Button
          onPress={() => {
            setVerifyFailedFor(null);
            setVerifyAttempt((attempt) => attempt + 1);
          }}
        >
          <Text>Try again</Text>
        </Button>
      </View>
    );
  }

  return (
    <RefreshablePage edges={[]}>
      <ScreenHeader
        title={group.name}
        subtitle={`${group.members.length} ${group.members.length === 1 ? "member" : "members"}`}
        fallback="/(tabs)/groups/list"
      />
      <View className="flex-1 bg-background pb-32 pt-2">
        <View className="gap-4 px-4">
          {keyAccess?.data?.current === "missing" && (
            <View className="gap-2 rounded-3xl bg-destructive-soft p-4">
              <Text className="font-semibold text-destructive-text">
                {`This ${thisDeviceNoun()} can’t access this group’s current encryption key`}
              </Text>
              <Text>{`Current group locations may be unavailable on this ${thisDeviceNoun()}.`}</Text>
            </View>
          )}
          {historyPartialFrom !== null && showHistoryWarning && (
            <View className="gap-2 rounded-3xl bg-warning p-4">
              <Text className="font-semibold text-warning-text">
                {`Some location history isn’t available on this ${thisDeviceNoun()}`}
              </Text>
              <Text>
                History from before{" "}
                {historyPartialFrom.toLocaleDateString(undefined, {
                  dateStyle: "medium",
                })}{" "}
                {`can’t be read on this ${thisDeviceNoun()}.`}
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
                  variant="secondary"
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
            tabs={GROUP_TABS.map((tab) =>
              tab.value === "history"
                ? { ...tab, badge: history.unseenGroupIds.has(groupId) && value !== "history" }
                : tab,
            )}
            value={value}
            onValueChange={setValue}
            renderScene={(tabValue) => {
              if (tabValue === "members") {
                return <MembersTab groupId={groupId} live={live} />;
              }

              if (tabValue === "places") {
                return (
                  <PlacesTab
                    groupId={groupId}
                    groupName={group.name}
                    livePositions={live.positions}
                  />
                );
              }

              if (tabValue === "history") {
                return (
                  <HistoryTab
                    active={value === "history"}
                    groupId={groupId}
                    latestAt={historyLatestAt}
                  />
                );
              }

              return <SettingsTab groupId={groupId} />;
            }}
          />
        </View>
      </View>
    </RefreshablePage>
  );
};

export default GroupScreen;
