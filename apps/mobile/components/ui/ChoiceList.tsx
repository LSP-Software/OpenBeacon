import { CheckIcon, type LucideIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { cn } from "../../lib/cn.ts";
import { Icon } from "./Icon.tsx";
import { Text } from "./Text.tsx";

export const ChoiceList = <T,>({
  accessibilityLabel,
  options,
  selected,
  onChange,
  disabled = false,
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
}) => (
  <View
    accessibilityRole="radiogroup"
    accessibilityLabel={accessibilityLabel}
    className="overflow-hidden rounded-2xl border border-border bg-card"
  >
    {options.map((option, index) => (
      <Pressable
        key={option.title}
        accessibilityRole="radio"
        accessibilityLabel={option.title}
        accessibilityHint={option.description}
        accessibilityState={{ checked: selected === option.value, disabled }}
        disabled={disabled}
        onPress={() => onChange(option.value)}
        className={cn(
          "min-h-[52px] flex-row items-center gap-3 px-4 py-3 active:bg-secondary/60",
          index > 0 && "border-t border-border/60",
          disabled && "opacity-50",
        )}
      >
        {option.icon ? <Icon as={option.icon} className="text-secondary size-5" /> : null}
        <View className="flex-1 gap-0.5">
          <Text className="text-foreground font-medium">{option.title}</Text>
          {option.description ? (
            <Text className="text-tertiary text-sm">{option.description}</Text>
          ) : null}
        </View>
        <View
          className={cn(
            "size-[22px] items-center justify-center rounded-full border-2",
            selected === option.value ? "border-primary bg-primary" : "border-border-strong",
          )}
        >
          {selected === option.value ? (
            <Icon as={CheckIcon} className="size-3.5 text-white" strokeWidth={3} />
          ) : null}
        </View>
      </Pressable>
    ))}
  </View>
);
