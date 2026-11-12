import { Pressable, View } from "react-native";
import { Text } from "./Text.tsx";

export const RadioCardGroup = <T,>({
  accessibilityLabel,
  options,
  selected,
  onChange,
}: {
  accessibilityLabel: string;
  options: readonly { value: T; title: string; description: string }[];
  selected: T;
  onChange: (value: T) => void;
}) => (
  <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} className="gap-3">
    {options.map((option) => (
      <Pressable
        key={option.title}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected === option.value }}
        onPress={() => onChange(option.value)}
        className={`flex-row items-start gap-3 rounded-xl border p-4 ${selected === option.value ? "border-primary bg-primary/10" : "border-border bg-card"}`}
      >
        <View
          className={`mt-0.5 size-5 items-center justify-center rounded-full border-2 ${selected === option.value ? "border-primary" : "border-muted-foreground"}`}
        >
          {selected === option.value && <View className="size-2.5 rounded-full bg-primary" />}
        </View>
        <View className="flex-1 gap-1">
          <Text className="font-semibold">{option.title}</Text>
          <Text className="text-muted-foreground">{option.description}</Text>
        </View>
      </Pressable>
    ))}
  </View>
);
