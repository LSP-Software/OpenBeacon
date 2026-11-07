import { Alert } from "../../lib/alert.ts";
import { generateRecoveryPhrase, type RecoveryPhrase } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from "expo-screen-capture";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { RecoveryCoverage } from "../../components/RecoveryCoverage.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc, trpcClient } from "../../lib/api.ts";
import {
  backfillHistoryWraps,
  confirmsRecoveryPhrase,
  pickConfirmationIndexes,
  setUpRecoveryPhrase,
} from "../../lib/recovery.ts";

const RecoveryPhraseSetupScreen = () => {
  const queryClient = useQueryClient();
  const [phrase, setPhrase] = useState<RecoveryPhrase | null>(() => generateRecoveryPhrase());
  const [confirmationIndexes] = useState(pickConfirmationIndexes);
  const [step, setStep] = useState<"show" | "confirm" | "saving" | "protecting" | "done">("show");
  const [progress, setProgress] = useState({ done: 0, failed: 0, total: 0 });
  const [userId, setUserId] = useState<string>();
  const form = useForm<{ words: string[] }>({ defaultValues: { words: ["", "", ""] } });

  useEffect(() => {
    if (!phrase) return;
    void tryCatch(preventScreenCaptureAsync("recovery-phrase"));
    return () => {
      void tryCatch(allowScreenCaptureAsync("recovery-phrase"));
    };
  }, [phrase]);

  const confirm = async ({ words }: { words: string[] }) => {
    if (!phrase) return;
    const answers = confirmationIndexes.map((index, position) => ({
      index,
      word: words[position] ?? "",
    }));
    if (!confirmsRecoveryPhrase({ answers, phrase })) {
      Alert.alert("Those words don’t match", "Check your written phrase and try again.");
      return;
    }
    setStep("saving");
    const result = await tryCatch(setUpRecoveryPhrase(phrase));
    if (result.error) {
      setStep("confirm");
      Alert.alert("Unable to set up recovery phrase", result.error.message);
      return;
    }
    form.reset();
    setPhrase(null);
    if (result.data.status === "conflict") {
      router.replace("/account/recovery-restore");
      return;
    }
    const { device } = result.data;
    setUserId(device.userId);
    void queryClient.invalidateQueries({ queryKey: trpc.accountRecovery.status.queryKey() });
    void queryClient.invalidateQueries({ queryKey: ["historyKeyHeld", device.userId] });
    void queryClient.invalidateQueries({ queryKey: ["groupKeyAccess", device.userId] });
    setStep("protecting");
    const groups = await tryCatch(trpcClient.groupMembership.list.query());
    const groupIds = groups.data?.map(({ id }) => id) ?? [];
    let failed = groups.error ? 1 : 0;
    setProgress({ done: 0, failed, total: groupIds.length });
    for (const [index, groupId] of groupIds.entries()) {
      const backfill = await tryCatch(backfillHistoryWraps({ device, groupId }));
      if (backfill.error) failed += 1;
      setProgress({ done: index + 1, failed, total: groupIds.length });
    }
    await queryClient.invalidateQueries({ queryKey: ["groupKeyAccess", device.userId] });
    setStep("done");
  };

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          {step === "saving" || step === "protecting" ? <View className="w-10" /> : <BackButton />}
          <Text className="text-foreground text-2xl font-bold">Recovery phrase</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-6 px-6 py-6 pb-32"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === "show" && phrase && (
            <View className="gap-4">
              <Text className="text-foreground text-3xl font-bold">Write these words down</Text>
              <Text className="text-muted-foreground text-base leading-6">
                Write them on paper, in order, and keep it somewhere safe. Anyone with these words
                and your password can read your location history.
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
          )}

          {(step === "confirm" || step === "saving") && (
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
                  contextMenuHidden
                />
              ))}
              <Button onPress={form.handleSubmit(confirm)} disabled={step === "saving"}>
                <Text>{step === "saving" ? "Setting up…" : "Confirm"}</Text>
              </Button>
              <Button
                variant="outline"
                onPress={() => setStep("show")}
                disabled={step === "saving"}
              >
                <Text>Show words again</Text>
              </Button>
            </View>
          )}

          {step === "protecting" && (
            <View className="gap-4">
              <Text className="text-foreground text-3xl font-bold">Protecting your history</Text>
              <Text accessibilityLiveRegion="polite" className="text-muted-foreground text-base">
                {progress.total === 0
                  ? "Checking your groups…"
                  : `Protected ${progress.done} of ${progress.total} groups.`}
              </Text>
            </View>
          )}

          {step === "done" && (
            <View className="gap-4">
              <Text className="text-foreground text-3xl font-bold">Your phrase is set up</Text>
              {progress.failed > 0 && (
                <Text className="text-muted-foreground text-base leading-6">
                  Some history couldn’t be protected yet. OpenBeacon will keep trying in the
                  background.
                </Text>
              )}
              <RecoveryCoverage userId={userId} />
              <Button onPress={() => router.back()}>
                <Text>Done</Text>
              </Button>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default RecoveryPhraseSetupScreen;
