import { Tabs } from "expo-router";
import { TabBar } from "../../components/TabBar.tsx";

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="groups/list"
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: "transparent" },
      }}
    >
      <Tabs.Screen name="groups/list" />
      <Tabs.Screen name="map" />
      <Tabs.Screen name="account" />
    </Tabs>
  );
}
