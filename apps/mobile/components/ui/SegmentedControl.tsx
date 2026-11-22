import {
  Text as ComposeText,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth, weight } from "@expo/ui/jetpack-compose/modifiers";
import { Picker, Text as SwiftText } from "@expo/ui/swift-ui";
import { disabled as disabledModifier, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { Platform, View } from "react-native";
import { cn } from "../../lib/cn.ts";
import { useColors } from "../../lib/theme.ts";
import { AndroidHost, IosHost } from "./NativeHost.tsx";

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
}) => {
  const { palette } = useColors();
  const selectedIndex = options.findIndex((option) => option.value === selected);
  const choose = (index: number) => {
    const option = options[index];
    if (option && !disabled) onChange(option.value);
  };

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      className={cn("w-full", disabled && "opacity-50")}
    >
      {Platform.OS === "ios" ? (
        <IosHost matchContents={{ vertical: true }} style={{ width: "100%" }}>
          <Picker
            label={accessibilityLabel}
            selection={selectedIndex}
            onSelectionChange={choose}
            modifiers={[pickerStyle("segmented"), disabledModifier(disabled)]}
          >
            {options.map((option, index) => (
              <SwiftText key={option.label} modifiers={[tag(index)]}>
                {option.label}
              </SwiftText>
            ))}
          </Picker>
        </IosHost>
      ) : (
        <AndroidHost matchContents={{ vertical: true }} style={{ width: "100%" }}>
          <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
            {options.map((option, index) => (
              <SegmentedButton
                key={option.label}
                selected={index === selectedIndex}
                enabled={!disabled}
                onClick={() => choose(index)}
                modifiers={[weight(1)]}
                colors={{
                  activeContainerColor: palette.secondary,
                  activeContentColor: palette["secondary-foreground"],
                  activeBorderColor: palette["border-strong"],
                  inactiveContainerColor: "#00000000",
                  inactiveContentColor: palette.foreground,
                  inactiveBorderColor: palette["border-strong"],
                }}
              >
                <SegmentedButton.Label>
                  <ComposeText maxLines={1} style={{ typography: "labelLarge" }}>
                    {option.label}
                  </ComposeText>
                </SegmentedButton.Label>
              </SegmentedButton>
            ))}
          </SingleChoiceSegmentedButtonRow>
        </AndroidHost>
      )}
    </View>
  );
};
