import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, Tabs } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { TabBar } from "../../components/TabBar.tsx";
import { trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { groupColorSyncQueryOptions } from "../../lib/groupColorSync.ts";

export default function TabsLayout() {
  const { data: session, isPending } = authClient.useSession();
  useQuery(groupColorSyncQueryOptions(session?.user.id));
  const { data: providers } = useQuery(trpc.auth.providers.queryOptions());
  const { mutate: setTimezone } = useMutation(trpc.emailAlerts.setTimezone.mutationOptions());
  const reportedTimezone = useRef<string | null>(null);
  const userId = session?.user.id;
  const emailEnabled = providers?.email === true;

  useEffect(() => {
    if (!userId || !emailEnabled) return;
    const report = () => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!timezone || reportedTimezone.current === `${userId}:${timezone}`) return;
      setTimezone(
        { timezone },
        { onSuccess: () => (reportedTimezone.current = `${userId}:${timezone}`) },
      );
    };
    report();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") report();
    });
    return () => subscription.remove();
  }, [userId, emailEnabled, setTimezone]);

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
