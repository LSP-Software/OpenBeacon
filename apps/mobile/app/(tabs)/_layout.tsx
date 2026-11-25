import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform } from "react-native";
import { useCallback, useEffect, useRef } from "react";
import { HistoryShareNotice } from "../../components/HistoryShareNotice.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { useAppForeground } from "../../hooks/useAppForeground.ts";
import { useRefetchWhileFocused } from "../../hooks/useRefetchWhileFocused.ts";
import { useUnseenGroupHistory } from "../../hooks/useUnseenGroupHistory.ts";
import { useUnits } from "../../hooks/useUnits.ts";
import { queryClient, trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { syncCrashAlertContext } from "../../lib/crashAlerts.ts";
import { groupColorSyncQueryOptions } from "../../lib/groupColorSync.ts";
import { checkImageKeys } from "../../lib/imageKeySelfCheck.ts";
import { useColors } from "../../lib/theme.ts";

const TabsLayout = () => {
  const { data: session, isPending } = authClient.useSession();
  useQuery(groupColorSyncQueryOptions(session?.user.id));
  const { data: providers } = useQuery(trpc.auth.providers.queryOptions());
  const { unseenGroupIds } = useUnseenGroupHistory();
  const { palette } = useColors();
  useRefetchWhileFocused([trpc.groupHistory.latest.queryKey()], 60_000);
  const { mutate: setTimezone } = useMutation({
    ...trpc.emailAlerts.setTimezone.mutationOptions(),
    scope: { id: "emailAlerts.setTimezone" },
  });
  const reportedTimezone = useRef<string | null>(null);
  const userId = session?.user.id;
  const emailEnabled = providers?.email === true;

  const reportTimezone = useCallback(() => {
    if (!userId || !emailEnabled) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const reported = `${userId}:${timezone}`;
    if (!timezone || reportedTimezone.current === reported) return;
    reportedTimezone.current = reported;
    setTimezone(
      { timezone },
      {
        onError: () => {
          if (reportedTimezone.current === reported) reportedTimezone.current = null;
        },
      },
    );
  }, [userId, emailEnabled, setTimezone]);

  useEffect(reportTimezone, [reportTimezone]);

  const { data: groups } = useQuery({
    ...trpc.groupMembership.list.queryOptions(),
    enabled: false,
  });
  const { speed: speedUnit } = useUnits();
  useEffect(() => {
    if (groups) syncCrashAlertContext(groups, speedUnit);
  }, [groups, speedUnit]);
  const userImage = session?.user.image ?? null;
  const userImageKeySealed = session?.user.imageKeySealed ?? null;
  const checkKeys = useCallback(() => {
    if (!groups || !userId) return;
    void tryCatch(
      checkImageKeys({
        groups,
        user: { id: userId, image: userImage, imageKeySealed: userImageKeySealed },
      }),
    ).then(async (checked) => {
      if (checked.data) {
        await queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() });
      }
    });
  }, [groups, userId, userImage, userImageKeySealed]);
  useEffect(checkKeys, [checkKeys]);
  useAppForeground(() => {
    reportTimezone();
    checkKeys();
  });

  if (isPending) {
    return <LoadingIndicator />;
  }

  if (!session) {
    return <Redirect href="/signIn" />;
  }

  return (
    <>
      <NativeTabs
        backBehavior="history"
        tintColor={palette["primary-text"]}
        {...(Platform.OS === "ios"
          ? {}
          : {
              backgroundColor: palette["tab-bar"],
              indicatorColor: palette["tab-indicator"],
              iconColor: {
                default: palette["text-secondary"],
                selected: palette["secondary-foreground"],
              },
              labelStyle: {
                default: { color: palette["text-secondary"] },
                selected: { color: palette.foreground },
              },
              badgeBackgroundColor: palette.action,
              labelVisibilityMode: "labeled" as const,
              rippleColor: palette.container,
            })}
      >
        <NativeTabs.Trigger
          name="groups"
          {...(Platform.OS === "android" && unseenGroupIds.size > 0
            ? { unstable_nativeProps: { badgeValue: "" } }
            : {})}
        >
          <NativeTabs.Trigger.Icon sf="person.2" md="group" />
          <NativeTabs.Trigger.Label>Groups</NativeTabs.Trigger.Label>
          {Platform.OS === "ios" ? (
            <NativeTabs.Trigger.Badge hidden={unseenGroupIds.size === 0} />
          ) : null}
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="map">
          <NativeTabs.Trigger.Icon sf="map" md="map" />
          <NativeTabs.Trigger.Label>Map</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="account">
          <NativeTabs.Trigger.Icon sf="person.crop.circle" md="person" />
          <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
      <HistoryShareNotice userId={session.user.id} />
    </>
  );
};

export default TabsLayout;
