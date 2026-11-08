import { Alert } from "../../lib/alert.ts";
import type { RecoveryPhrase } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConfirmIdentity } from "../../components/ConfirmIdentity.tsx";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { NewRecoveryPhrase } from "../../components/NewRecoveryPhrase.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";
import { changeRecoveryPhrase } from "../../lib/recovery.ts";

const RecoveryPhraseChangeScreen = () => {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"verify" | "phrase" | "saving" | "done">("verify");

  const change = async (phrase: RecoveryPhrase) => {
    setStep("saving");
    const result = await tryCatch(changeRecoveryPhrase(phrase));
    if (result.error) {
      setStep("phrase");
      Alert.alert("Unable to change recovery phrase", result.error.message);
      return;
    }
    if (result.data.status === "reauthenticate") {
      setStep("verify");
      Alert.alert(
        "Sign in again",
        "Your phrase wasn’t changed. Confirm it’s you, then write down the new phrase you’re shown.",
      );
      return;
    }
    void queryClient.invalidateQueries({ queryKey: trpc.accountRecovery.status.queryKey() });
    setStep("done");
  };

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          {step === "saving" ? <View className="w-10" /> : <BackButton />}
          <Text className="text-foreground text-2xl font-bold">Change phrase</Text>
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
          {step === "verify" && (
            <View className="gap-6">
              <Text className="text-muted-foreground text-base leading-6">
                You’ll get a new 12-word phrase to write down. Your old phrase stops working as soon
                as the new one is saved. Your groups and location history aren’t affected.
              </Text>
              <ConfirmIdentity onConfirmed={() => setStep("phrase")} />
            </View>
          )}

          {(step === "phrase" || step === "saving") && (
            <NewRecoveryPhrase
              onConfirm={change}
              submitLabel="Change phrase"
              submittingLabel="Changing…"
            />
          )}

          {step === "done" && (
            <View className="gap-4">
              <Text className="text-foreground text-3xl font-bold">Your phrase is changed</Text>
              <Text className="text-muted-foreground text-base leading-6">
                Use your new phrase to read your history on a new phone. Your old phrase no longer
                works.
              </Text>
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

export default RecoveryPhraseChangeScreen;
