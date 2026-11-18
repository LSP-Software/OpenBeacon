import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { type LucideIcon, MapIcon, UserIcon, UsersIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { cn } from "../lib/cn.ts";
import { Icon } from "./ui/Icon.tsx";
import { Text } from "./ui/Text.tsx";

const TABS: Record<string, { label: string; icon: LucideIcon; prefix: string }> = {
  "groups/list": { label: "Groups", icon: UsersIcon, prefix: "groups/" },
  "map/index": { label: "Map", icon: MapIcon, prefix: "map/" },
  "account/overview": { label: "Account", icon: UserIcon, prefix: "account/" },
};

const TabBar = ({
  state,
  navigation,
  groupsBadge,
}: BottomTabBarProps & { groupsBadge: boolean }) => {
  const currentRouteName = state.routes[state.index]?.name ?? "";

  const handleTabPress = (key: string, name: string) => {
    const event = navigation.emit({
      type: "tabPress",
      target: key,
      canPreventDefault: true,
    });
    if (!event.defaultPrevented) {
      navigation.navigate(name);
    }
  };

  return (
    <SafeAreaView edges={["bottom"]} className="absolute bottom-0 left-0 right-0 bg-background">
      <View className="flex-row items-center justify-around border-t border-border px-4 pb-1 pt-2">
        {state.routes.map((route) => {
          const tab = TABS[route.name];
          if (!tab) return null;

          const isActive =
            currentRouteName === route.name || currentRouteName.startsWith(tab.prefix);

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={
                route.name === "groups/list" && groupsBadge
                  ? `${tab.label}, new activity`
                  : tab.label
              }
              className="w-24 items-center gap-1 py-1"
              onPress={() => handleTabPress(route.key, route.name)}
            >
              <View className="h-8 w-16 items-center justify-center">
                {isActive ? (
                  <View className="absolute inset-0 rounded-full bg-primary-soft" />
                ) : null}
                <Icon
                  as={tab.icon}
                  size={22}
                  className={isActive ? "text-primary-text" : "text-secondary"}
                />
                {route.name === "groups/list" && groupsBadge ? (
                  <View className="absolute right-3.5 top-0.5 size-2.5 rounded-full border-2 border-background bg-primary" />
                ) : null}
              </View>
              <Text
                className={cn(
                  "text-xs font-medium text-secondary",
                  isActive && "font-semibold text-primary-text",
                )}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
};

export { TabBar };
