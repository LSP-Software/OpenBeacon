import { Tabs } from "expo-router";
import { TabBar } from "../../components/TabBar.tsx";

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="map"
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
      <Tabs.Screen name="groups" />
      <Tabs.Screen name="map" />
      <Tabs.Screen name="account" />
    </Tabs>
  );
}
