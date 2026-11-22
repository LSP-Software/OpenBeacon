import type { LucideIcon } from "lucide-react-native";
import { Platform, View } from "react-native";
import { useColors } from "../../lib/theme.ts";
import { ListRow, ListSection } from "./List.tsx";

export const ChoiceList = <T,>({
  accessibilityLabel,
  options,
  selected,
  onChange,
  disabled = false,
  title,
  footer,
}: {
  accessibilityLabel: string;
  options: readonly {
    value: T;
    title: string;
    description?: string | undefined;
    icon?: LucideIcon | undefined;
  }[];
  selected: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  title?: string | undefined;
  footer?: React.ReactNode;
}) => (
  <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
    <ListSection title={title} footer={footer}>
      {options.map((option) => (
        <ListRow
          key={option.title}
          title={option.title}
          subtitle={option.description}
          icon={option.icon}
          accessibilityRole="radio"
          accessibilityLabel={option.title}
          accessibilityHint={option.description}
          selected={selected === option.value}
          disabled={disabled}
          onPress={() => onChange(option.value)}
          leading={
            Platform.OS === "ios" ? null : <RadioMark selected={selected === option.value} />
          }
        />
      ))}
    </ListSection>
  </View>
);

const RadioMark = ({ selected }: { selected: boolean }) => {
  const { palette } = useColors();
  const color = selected ? palette["primary-text"] : palette["text-secondary"];
  return (
    <View
      className="size-5 items-center justify-center rounded-full border-2"
      style={{ borderColor: color }}
    >
      <View
        className="size-2.5 rounded-full"
        style={{ backgroundColor: selected ? color : "transparent" }}
      />
    </View>
  );
};
