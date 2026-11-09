import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, Tabs } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { TabBar } from "../../components/TabBar.tsx";
import { authClient } from "../../lib/auth-client.ts";
import { groupColorSyncQueryOptions } from "../../lib/groupColorSync.ts";

export default function TabsLayout() {
  const { data: session, isPending } = authClient.useSession();
  useQuery(groupColorSyncQueryOptions(session?.user.id));
  const queryClient = useQueryClient();

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void queryClient.invalidateQueries({ queryKey: ["personalGroupColors"] });
      void queryClient.invalidateQueries({ queryKey: ["personalNicknames"] });
    });
    return () => subscription.remove();
  }, [queryClient]);

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
