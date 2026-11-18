import { Pressable, View } from "react-native";
import { cn } from "../../lib/cn.ts";

export const Switch = ({
  accessibilityLabel,
  disabled = false,
  onValueChange,
  value,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  value: boolean;
}) => (
  <Pressable
    accessibilityRole="switch"
    accessibilityLabel={accessibilityLabel}
    accessibilityState={{ checked: value, disabled }}
    disabled={disabled}
    hitSlop={10}
    onPress={() => onValueChange(!value)}
    className={cn(
      "h-[30px] w-[50px] flex-row items-center rounded-full px-[3px]",
      value ? "justify-end bg-primary" : "justify-start bg-border-strong",
      disabled && "opacity-50",
    )}
  >
    <View className="size-6 rounded-full bg-white" />
  </Pressable>
);
