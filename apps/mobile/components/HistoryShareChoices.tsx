import type { HistoryShare } from "@openbeacon/shared";
import { CheckIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { cn } from "../lib/cn.ts";
import { historyShareChoices, historyShareLabel } from "../lib/historyShare.ts";
import { Icon } from "./ui/Icon.tsx";
import { Text } from "./ui/Text.tsx";

export const HistoryShareChoices = ({
  accountShare,
  disabled = false,
  onChange,
  value,
}: {
  accountShare?: HistoryShare;
  disabled?: boolean;
  onChange: (value: HistoryShare | null) => void;
  value: HistoryShare | null;
}) => {
  const options = [
    ...(accountShare
      ? [
          {
            value: null,
            label: "Use my account setting",
            description: historyShareLabel(accountShare),
          },
        ]
      : []),
    ...historyShareChoices.map((choice) => ({ ...choice, description: null })),
  ];
  return (
    <View
      accessibilityRole="radiogroup"
      className="overflow-hidden rounded-3xl border border-border bg-card"
    >
      {options.map((option, index) => {
        const selected = value === option.value;
        return (
          <Pressable
            key={option.value ?? "account"}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            className={cn(
              "min-h-14 flex-row items-center gap-4 px-5 py-3",
              index < options.length - 1 && "border-b border-border/50",
              disabled && "opacity-60",
            )}
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
          >
            <View className="flex-1 gap-0.5">
              <Text className="text-foreground text-base font-medium">{option.label}</Text>
              {option.description ? (
                <Text className="text-muted-foreground text-sm">{option.description}</Text>
              ) : null}
            </View>
            <View
              className={cn(
                "size-6 items-center justify-center rounded-full border",
                selected ? "border-primary bg-primary" : "border-border bg-background",
              )}
            >
              {selected ? <Icon as={CheckIcon} className="size-4 text-primary-foreground" /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
};
