import { generateRecoveryPhrase, type RecoveryPhrase } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from "expo-screen-capture";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { View } from "react-native";
import { Alert } from "../lib/alert.ts";
import { confirmsRecoveryPhrase, pickConfirmationIndexes } from "../lib/recovery.ts";
import { useSingleFlight } from "../lib/useSingleFlight.ts";
import { Button } from "./ui/Button.tsx";
import { Input } from "./ui/Input.tsx";
import { Text } from "./ui/Text.tsx";

export const NewRecoveryPhrase = ({
  onConfirm,
  submitLabel,
  submittingLabel,
}: {
  onConfirm: (phrase: RecoveryPhrase) => Promise<void>;
  submitLabel: string;
  submittingLabel: string;
}) => {
  const [phrase] = useState(generateRecoveryPhrase);
  const [confirmationIndexes] = useState(pickConfirmationIndexes);
  const [step, setStep] = useState<"show" | "confirm">("show");
  const submission = useSingleFlight<"confirm">();
  const form = useForm<{ words: string[] }>({ defaultValues: { words: ["", "", ""] } });

  useEffect(() => {
    void tryCatch(preventScreenCaptureAsync("new-recovery-phrase"));
    return () => {
      void tryCatch(allowScreenCaptureAsync("new-recovery-phrase"));
    };
  }, []);

  const confirm = async ({ words }: { words: string[] }) => {
    const answers = confirmationIndexes.map((index, position) => ({
      index,
      word: words[position] ?? "",
    }));
    if (!confirmsRecoveryPhrase({ answers, phrase })) {
      Alert.alert("Those words don’t match", "Check your written phrase and try again.");
      return;
    }
    await submission.run("confirm", async () => {
      const result = await tryCatch(onConfirm(phrase));
      if (result.error) {
        Alert.alert("Something went wrong", result.error.message);
        return;
      }
      form.reset();
    });
  };

  if (step === "show") {
    return (
      <View className="gap-4">
        <Text className="text-foreground text-3xl font-bold">Write these words down</Text>
        <Text className="text-muted-foreground text-base leading-6">
          Write them on paper, in order, and keep it somewhere safe. Anyone with these words who can
          sign in to your account can read your location history.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {phrase.words().map((word, index) => (
            <View
              key={index}
              className="w-[48%] flex-row gap-2 rounded-lg border border-border bg-card px-3 py-2"
            >
              <Text className="text-muted-foreground w-6">{index + 1}</Text>
              <Text selectable={false} className="font-semibold">
                {word}
              </Text>
            </View>
          ))}
        </View>
        <Button onPress={() => setStep("confirm")}>
          <Text>I’ve written it down</Text>
        </Button>
      </View>
    );
  }

  return (
    <View className="gap-4">
      <Text className="text-foreground text-3xl font-bold">Check your phrase</Text>
      <Text className="text-muted-foreground text-base leading-6">
        Enter these words from your written phrase.
      </Text>
      {confirmationIndexes.map((index, position) => (
        <Input
          key={index}
          control={form.control}
          name={`words.${position}`}
          label={`Word ${index + 1}`}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          importantForAutofill="no"
          textContentType="none"
          contextMenuHidden
        />
      ))}
      <Button onPress={form.handleSubmit(confirm)} disabled={submission.isPending}>
        <Text>{submission.isPending ? submittingLabel : submitLabel}</Text>
      </Button>
      <Button variant="outline" onPress={() => setStep("show")} disabled={submission.isPending}>
        <Text>Show words again</Text>
      </Button>
    </View>
  );
};
