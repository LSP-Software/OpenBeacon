import { Link } from "expo-router";
import { ChevronRightIcon, ExternalLinkIcon, type LucideIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { cn } from "../../lib/cn.ts";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";

export const SettingsContainer = ({
  categories,
}: {
  categories: {
    label?: string;
    settings: {
      label: string;
      icon: LucideIcon;
      href?: string;
      onPress?: () => void;
      value?: string | undefined;
      tone?: "danger";
      disabled?: boolean;
    }[];
  }[];
}) => {
  return (
    <View className="gap-5">
      {categories.map((category) => {
        return (
          <View key={category.settings[0]?.label} className="gap-2">
            {category.label ? <Text variant="label">{category.label}</Text> : null}
            <View className="overflow-hidden rounded-2xl border border-border bg-card">
              {category.settings.map((setting, settingIndex) => {
                const row = (
                  <Pressable
                    accessibilityRole={setting.href ? "link" : "button"}
                    accessibilityLabel={
                      setting.value ? `${setting.label}, ${setting.value}` : setting.label
                    }
                    accessibilityState={{ disabled: setting.disabled ?? false }}
                    disabled={setting.disabled ?? false}
                    onPress={setting.onPress}
                    className={cn(
                      "min-h-[52px] flex-row items-center gap-3 px-4 py-3 active:bg-secondary/60",
                      settingIndex > 0 && "border-t border-border/60",
                      setting.disabled && "opacity-50",
                    )}
                  >
                    <Icon
                      as={setting.icon}
                      className={cn(
                        "size-5",
                        setting.tone === "danger" ? "text-destructive-text" : "text-secondary",
                      )}
                    />
                    <Text
                      className={cn(
                        "flex-1 font-medium",
                        setting.tone === "danger" ? "text-destructive-text" : "text-foreground",
                      )}
                    >
                      {setting.label}
                    </Text>
                    {setting.value ? (
                      <Text className="text-tertiary text-sm" numberOfLines={1}>
                        {setting.value}
                      </Text>
                    ) : null}
                    {setting.href ? (
                      <Icon
                        as={setting.href.startsWith("http") ? ExternalLinkIcon : ChevronRightIcon}
                        className="text-tertiary size-5"
                      />
                    ) : null}
                  </Pressable>
                );

                return setting.href ? (
                  <Link key={setting.label} href={setting.href} asChild>
                    {row}
                  </Link>
                ) : (
                  <View key={setting.label}>{row}</View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
};
