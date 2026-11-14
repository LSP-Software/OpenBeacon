import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, Tabs } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { TabBar } from "../../components/TabBar.tsx";
import { useAppForeground } from "../../hooks/useAppForeground.ts";
import { trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { groupColorSyncQueryOptions } from "../../lib/groupColorSync.ts";

export default function TabsLayout() {
  const { data: session, isPending } = authClient.useSession();
  useQuery(groupColorSyncQueryOptions(session?.user.id));
  const { data: providers } = useQuery(trpc.auth.providers.queryOptions());
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
  useAppForeground(reportTimezone);

  if (isPending) {
    return <LoadingIndicator />;
  }

  if (!session) {
    return <Redirect href="/signIn" />;
  }

  return (
    <Tabs
      initialRouteName="groups/list"
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: "transparent" },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: "transparent",
          borderTopWidth: 0,
          elevation: 0,
        },
      }}
    >
      <Tabs.Screen name="groups/list" />
      <Tabs.Screen name="map/index" />
      <Tabs.Screen name="account/overview" />
    </Tabs>
  );
}
