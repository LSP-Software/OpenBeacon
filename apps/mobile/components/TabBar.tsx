import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { type LucideIcon, MapIcon, UserIcon, UsersIcon } from "lucide-react-native";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { cn } from "../lib/cn.ts";
import { Button } from "./ui/Button.tsx";
import { Icon } from "./ui/Icon.tsx";

const TABS: Record<string, { label: string; icon: LucideIcon; prefix: string }> = {
  "groups/list": { label: "Groups", icon: UsersIcon, prefix: "groups/" },
  "map/index": { label: "Map", icon: MapIcon, prefix: "map/" },
  "account/overview": { label: "Account", icon: UserIcon, prefix: "account/" },
};

const TabBar = ({ state, navigation }: BottomTabBarProps) => {
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
      <View className="flex-row items-center justify-between border-t border-border px-4 py-4">
        {state.routes.map((route) => {
          const tab = TABS[route.name];
          if (!tab) return null;

          const isActive =
            currentRouteName === route.name || currentRouteName.startsWith(tab.prefix);

          return (
            <TabLink
              key={route.key}
              isActive={isActive}
              label={tab.label}
              icon={tab.icon}
              onPress={() => handleTabPress(route.key, route.name)}
            />
          );
        })}
      </View>
    </SafeAreaView>
  );
};

const TabLink = ({
  label,
  icon,
  onPress,
  isActive,
}: {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  isActive: boolean;
}) => {
  return (
    <Button
      variant={"link"}
      className={cn("flex-col gap-1 items-center justify-center")}
      onPress={onPress}
    >
      <Icon as={icon} size={20} className={cn(isActive && "text-primary")} />
      <Text className={cn("text-muted", isActive && "text-primary font-semibold")}>{label}</Text>
    </Button>
  );
};

export { TabBar };
