import type { Href } from "expo-router";
import type { LucideIcon } from "lucide-react-native";
import { View } from "react-native";
import { type ListIconColor, ListRow, ListSection } from "../ui/List.tsx";

export const SettingsContainer = ({
  categories,
}: {
  categories: {
    label?: string;
    footer?: string;
    settings: {
      label: string;
      icon: LucideIcon;
      color?: ListIconColor;
      href?: Href;
      onPress?: () => void;
      value?: string | undefined;
      tone?: "danger";
      disabled?: boolean;
    }[];
  }[];
}) => (
  <View className="gap-6">
    {categories.map((category) => (
      <ListSection
        key={category.settings[0]?.label}
        title={category.label}
        footer={category.footer}
      >
        {category.settings.map((setting) => (
          <ListRow
            key={setting.label}
            title={setting.label}
            icon={setting.icon}
            iconColor={setting.color}
            href={setting.href}
            onPress={setting.onPress}
            value={setting.value}
            tone={setting.tone}
            disabled={setting.disabled}
          />
        ))}
      </ListSection>
    ))}
  </View>
);
