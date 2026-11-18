import { Pressable, View } from "react-native";
import { cn } from "../../lib/cn.ts";
import { Text } from "./Text.tsx";

export const SegmentedControl = <T,>({
  accessibilityLabel,
  options,
  selected,
  onChange,
  disabled = false,
}: {
  accessibilityLabel: string;
  options: readonly { value: T; label: string }[];
  selected: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) => (
  <View
    accessibilityRole="radiogroup"
    accessibilityLabel={accessibilityLabel}
    className={cn("flex-row rounded-xl bg-secondary p-1", disabled && "opacity-50")}
  >
    {options.map((option) => (
      <Pressable
        key={option.label}
        accessibilityRole="radio"
        accessibilityLabel={option.label}
        accessibilityState={{ checked: selected === option.value, disabled }}
        disabled={disabled}
        onPress={() => onChange(option.value)}
        className={cn(
          "h-10 flex-1 items-center justify-center rounded-lg px-2",
          selected === option.value && "bg-card dark:bg-border-strong",
        )}
      >
        <Text
          numberOfLines={1}
          className={cn(
            "text-sm",
            selected === option.value
              ? "text-foreground font-semibold"
              : "text-secondary font-medium",
          )}
        >
          {option.label}
        </Text>
      </Pressable>
    ))}
  </View>
);
