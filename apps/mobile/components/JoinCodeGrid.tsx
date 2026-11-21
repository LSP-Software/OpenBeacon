import { View } from "react-native";
import { Text } from "./ui/Text.tsx";

export const JoinCodeGrid = ({ code, hidden }: { code: string; hidden?: boolean }) => {
  const groups = Array.from({ length: 8 }, (_, index) => ({
    slot: index,
    text: code.slice(index * 4, index * 4 + 4),
  }));
  return (
    <View
      accessible={!hidden}
      accessibilityLabel={groups
        .filter((group) => group.text)
        .map((group) => group.text.split("").join(" "))
        .join(", ")}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "yes"}
      className="gap-1.5"
    >
      {[groups.slice(0, 4), groups.slice(4)].map((row) => (
        <View key={row[0]?.slot} className="flex-row justify-between">
          {row.map((group) => (
            <Text
              key={group.slot}
              maxFontSizeMultiplier={1.15}
              className="font-mono text-xl font-semibold tracking-wider"
            >
              {group.text}
              <Text maxFontSizeMultiplier={1.15} className="font-mono text-xl text-tertiary">
                {"····".slice(group.text.length)}
              </Text>
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
};
