import { Redirect, Tabs } from "expo-router";
import { TabBar } from "../../components/TabBar.tsx";
import { authClient } from "../../lib/auth-client.ts";

export default function TabsLayout() {
  const { data: session } = authClient.useSession();
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
