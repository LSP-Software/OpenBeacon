import { Platform, Switch as NativeSwitch } from "react-native";
import { useColors } from "../../lib/theme.ts";

export const Switch = ({
  accessibilityLabel,
  disabled,
  onValueChange,
  value,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  value: boolean;
}) => {
  const colors = useColors();

  return (
    <NativeSwitch
      accessibilityLabel={accessibilityLabel}
      value={value}
      disabled={disabled}
      trackColor={{ true: colors.primary }}
      // Android's SwitchCompat tints the on thumb with the AppCompat accent (teal) unless thumbColor is set.
      thumbColor={Platform.OS === "android" && value ? colors.primary : undefined}
      onValueChange={onValueChange}
    />
  );
};
