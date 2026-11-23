import { useState } from "react";
import { TextInput, type TextInputProps, View } from "react-native";
import Animated, { type SharedValue, useAnimatedProps } from "react-native-reanimated";
import { useColors } from "../../lib/theme.ts";
import { timelineMinuteLabelAt } from "../../lib/timelineTrack.ts";

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export const TimelineClockText = ({
  accessibilityLabel,
  day,
  endLabel,
  labels,
  time,
}: {
  accessibilityLabel: string;
  day: { end: number; start: number };
  endLabel: string;
  labels: readonly string[];
  time: SharedValue<number>;
}) => {
  const colors = useColors();
  const dayStart = day.start;
  const dayEnd = day.end;
  const [initial] = useState(() =>
    timelineMinuteLabelAt(labels, endLabel, { end: dayEnd, start: dayStart }, time.value),
  );
  const animatedProps = useAnimatedProps((): Partial<TextInputProps> & { text: string } => {
    const label = timelineMinuteLabelAt(
      labels,
      endLabel,
      { end: dayEnd, start: dayStart },
      time.value,
    );
    return { defaultValue: label, text: label };
  });
  return (
    <View accessible accessibilityLabel={accessibilityLabel} accessibilityRole="text">
      <AnimatedTextInput
        animatedProps={animatedProps}
        caretHidden
        contextMenuHidden
        defaultValue={initial}
        editable={false}
        importantForAccessibility="no-hide-descendants"
        maxFontSizeMultiplier={1.5}
        pointerEvents="none"
        underlineColorAndroid="transparent"
        style={{
          color: colors.text,
          fontSize: 30,
          fontVariant: ["tabular-nums"],
          fontWeight: "600",
          lineHeight: 36,
          margin: 0,
          padding: 0,
        }}
      />
    </View>
  );
};
