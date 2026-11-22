import { Switch as ComposeSwitch } from "@expo/ui/jetpack-compose";
import { Toggle } from "@expo/ui/swift-ui";
import { labelsHidden, tint } from "@expo/ui/swift-ui/modifiers";
import { Platform, Pressable, View } from "react-native";
import { cn } from "../../lib/cn.ts";
import { useColors } from "../../lib/theme.ts";
import { AndroidHost, IosHost } from "./NativeHost.tsx";

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
}) => {
  const { palette } = useColors();

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={10}
      onPress={() => onValueChange(!value)}
      className={cn(disabled && "opacity-50")}
    >
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
        {Platform.OS === "ios" ? (
          <IosHost matchContents>
            <Toggle
              isOn={value}
              label={accessibilityLabel}
              modifiers={[labelsHidden(), tint(palette.action)]}
            />
          </IosHost>
        ) : (
          <AndroidHost matchContents>
            <ComposeSwitch
              value={value}
              colors={{
                checkedTrackColor: palette["primary-text"],
                checkedThumbColor: palette["on-primary-text"],
                checkedBorderColor: palette["primary-text"],
                uncheckedTrackColor: palette.container,
                uncheckedThumbColor: palette["border-strong"],
                uncheckedBorderColor: palette["border-strong"],
              }}
            />
          </AndroidHost>
        )}
      </View>
    </Pressable>
  );
};
