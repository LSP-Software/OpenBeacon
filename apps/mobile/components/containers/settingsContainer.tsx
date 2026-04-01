import { Link } from "expo-router";
import { ChevronRightIcon, type LucideIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";

interface SettingsContainerProps {
  categories: {
    label: string;
    settings: {
      label: string;
      icon: LucideIcon;
      href: string;
    }[];
  }[];
}

export const SettingsContainer = ({ categories }: SettingsContainerProps) => {
  return (
    <View className="flex flex-col gap-2">
      {categories.map((category) => {
        return (
          <View key={category.label}>
            <Text className="mb-1 text-lg font-medium text-muted-foreground">{category.label}</Text>
            <View className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
              {category.settings.map((setting, settingIndex) => {
                const isLastSetting = settingIndex === category.settings.length - 1;

                return (
                  <Link key={setting.label} href={setting.href} asChild>
                    <Pressable
                      className={`flex flex-row items-center justify-between ${
                        isLastSetting ? "" : "border-b-[0.5px] border-border/30 pb-3"
                      }`}
                    >
                      <View className="flex flex-row items-center gap-3">
                        <Icon as={setting.icon} className="text-muted-foreground size-6" />
                        <Text className="text-foreground font-medium">{setting.label}</Text>
                      </View>
                      <Icon as={ChevronRightIcon} className="text-muted-foreground size-6" />
                    </Pressable>
                  </Link>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
};
