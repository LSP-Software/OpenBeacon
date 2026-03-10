import { Tabs } from "expo-router";
import { TabBar } from "../../components/TabBar.tsx";

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="map"
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: "transparent" },
      }}
    >
      <Tabs.Screen name="groups" />
      <Tabs.Screen name="map" />
      <Tabs.Screen name="account" />
    </Tabs>
  );
}
