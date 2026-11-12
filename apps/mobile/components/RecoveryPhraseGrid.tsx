import { EyeIcon, EyeOffIcon } from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { cn } from "../lib/cn.ts";
import { fillRecoveryWords } from "../lib/fillRecoveryWords.ts";
import { Button } from "./ui/Button.tsx";
import { Icon } from "./ui/Icon.tsx";
import { Text } from "./ui/Text.tsx";

export const RecoveryPhraseGrid = ({
  words,
  positions,
  onChangeWords,
  onSubmit,
  invalidIndexes = [],
  editable = true,
}: {
  words: string[];
  positions?: number[];
  onChangeWords?: (words: string[]) => void;
  onSubmit?: () => void;
  invalidIndexes?: number[] | undefined;
  editable?: boolean;
}) => {
  const [revealed, setRevealed] = useState(false);
  const inputs = useRef<(TextInput | null)[]>([]);
  const numberOf = (index: number) => positions?.[index] ?? index + 1;

  if (!onChangeWords) {
    return (
      <View className="flex-row flex-wrap gap-2">
        {words.map((word, index) => (
          <View
            key={numberOf(index)}
            className="w-[48%] flex-row gap-2 rounded-lg border border-border bg-card px-3 py-2"
          >
            <Text className="text-muted-foreground w-6">{numberOf(index)}</Text>
            <Text selectable={false} className="font-semibold">
              {word}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  const change = (index: number, text: string) => {
    const filled = fillRecoveryWords(words, index, text);
    onChangeWords(filled.words);
    if (filled.focusIndex !== index) inputs.current[filled.focusIndex]?.focus();
  };

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-2">
        {words.map((word, index) => {
          const last = index === words.length - 1;
          return (
            <Pressable
              key={numberOf(index)}
              onPress={() => inputs.current[index]?.focus()}
              className={cn(
                "w-[48%] flex-row items-center gap-2 rounded-lg border border-border bg-card px-3",
                invalidIndexes.includes(index) && "border-destructive",
                !editable && "opacity-50",
              )}
            >
              <Text className="text-muted-foreground w-6">{numberOf(index)}</Text>
              <TextInput
                ref={(instance) => {
                  inputs.current[index] = instance;
                }}
                value={word}
                onChangeText={(text) => change(index, text)}
                onSubmitEditing={last ? onSubmit : () => inputs.current[index + 1]?.focus()}
                submitBehavior={last ? "blurAndSubmit" : "submit"}
                returnKeyType={last ? "done" : "next"}
                secureTextEntry={!revealed}
                editable={editable}
                accessibilityLabel={`Word ${numberOf(index)} of 12`}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="off"
                importantForAutofill="no"
                textContentType="oneTimeCode"
                contextMenuHidden
                className="text-foreground flex-1 py-3 font-mono text-base font-semibold"
              />
            </Pressable>
          );
        })}
      </View>
      <Button
        variant="ghost"
        size="sm"
        accessibilityRole="button"
        accessibilityLabel={revealed ? "Hide words" : "Show words"}
        onPress={() => setRevealed((current) => !current)}
      >
        <Icon as={revealed ? EyeOffIcon : EyeIcon} size={18} />
        <Text>{revealed ? "Hide words" : "Show words"}</Text>
      </Button>
    </View>
  );
};
