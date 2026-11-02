import { Link } from "expo-router";
import { ChevronRightIcon, type LucideIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";

export const SettingsContainer = ({
  categories,
}: {
  categories: {
    label: string;
    settings: {
      label: string;
      icon: LucideIcon;
      href?: string;
    }[];
  }[];
}) => {
  return (
    <View className="flex flex-col gap-2">
      {categories.map((category) => {
        return (
          <View key={category.label}>
            <Text className="mb-1 text-lg font-medium text-muted-foreground">{category.label}</Text>
            <View className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
              {category.settings.map((setting, settingIndex) => {
                const isLastSetting = settingIndex === category.settings.length - 1;

                const content = (
                  <View
                    key={setting.label}
                    className={`flex flex-row items-center justify-between ${
                      isLastSetting ? "" : "border-b-[0.5px] border-border/30 pb-3"
                    }`}
                  >
                    <View className="flex flex-row items-center gap-3">
                      <Icon as={setting.icon} className="text-muted-foreground size-6" />
                      <Text
                        className={`font-medium ${setting.href ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        {setting.label}
                      </Text>
                    </View>
                    <Icon as={ChevronRightIcon} className="text-muted-foreground size-6" />
                  </View>
                );

                return setting.href ? (
                  <Link key={setting.label} href={setting.href} asChild>
                    <Pressable>{content}</Pressable>
                  </Link>
                ) : (
                  <View key={setting.label} accessibilityState={{ disabled: true }}>
                    {content}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
};
