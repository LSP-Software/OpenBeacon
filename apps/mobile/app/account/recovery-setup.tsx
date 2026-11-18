import { Alert } from "../../lib/alert.ts";
import type { RecoveryPhrase } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { ConfirmIdentity } from "../../components/ConfirmIdentity.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { NewRecoveryPhrase } from "../../components/NewRecoveryPhrase.tsx";
import { RecoveryCoverage } from "../../components/RecoveryCoverage.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useIdentityGate } from "../../hooks/useIdentityGate.ts";
import { trpc } from "../../lib/api.ts";
import { protectHistory } from "../../lib/protectHistory.ts";
import { setUpRecoveryPhrase } from "../../lib/recovery.ts";
import { userMessage } from "../../lib/userMessage.ts";

const RecoveryPhraseSetupScreen = () => {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"verify" | "phrase" | "saving" | "protecting" | "done">(
    "verify",
  );
  const gate = useIdentityGate();

  useEffect(() => {
    if (step === "verify" && gate.decision === "ready") {
      setStep("phrase");
    }
  }, [step, gate.decision]);
  const [progress, setProgress] = useState({ done: 0, failed: 0, total: 0 });
  const [userId, setUserId] = useState<string>();

  const setUp = async (phrase: RecoveryPhrase) => {
    setStep("saving");
    const result = await tryCatch(setUpRecoveryPhrase(phrase));
    if (result.error) {
      setStep("phrase");
      Alert.alert("Unable to set up recovery phrase", userMessage(result.error));
      return;
    }
    if (result.data.status === "reauthenticate") {
      await gate.recheck();
      setStep("verify");
      Alert.alert(
        "Sign in again",
        "Your phrase wasn’t set up. Confirm it’s you, then write down the new phrase you’re shown.",
      );
      return;
    }
    if (result.data.status === "conflict") {
      void queryClient.invalidateQueries({ queryKey: trpc.accountRecovery.status.queryKey() });
      Alert.alert(
        "Recovery phrase already set up",
        "A recovery phrase was already set up on another phone. The words you just wrote down won’t work and can be thrown away. Enter the phrase from the other phone instead.",
      );
      router.replace("/account/recovery-restore");
      return;
    }
    const { device } = result.data;
    void queryClient.invalidateQueries({ queryKey: trpc.accountRecovery.status.queryKey() });
    void queryClient.invalidateQueries({ queryKey: ["historyKeyHeld", device.userId] });
    void queryClient.invalidateQueries({ queryKey: ["groupKeyAccess", device.userId] });
    setUserId(device.userId);
    setStep("protecting");
    await protectHistory({ device, onProgress: setProgress });
    void queryClient.invalidateQueries({ queryKey: ["groupKeyAccess", device.userId] });
    void queryClient.invalidateQueries({ queryKey: ["personalNicknames"] });
    setStep("done");
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Recovery phrase" hideBack={step === "saving" || step === "protecting"} />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-6 px-4 pb-32 pt-2"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === "verify" && gate.decision === null && <LoadingIndicator />}
          {step === "verify" && gate.decision === "confirm" && (
            <ConfirmIdentity
              onConfirmed={() => {
                void gate.refresh();
                setStep("phrase");
              }}
            />
          )}

          {(step === "phrase" || step === "saving") && (
            <NewRecoveryPhrase
              onConfirm={setUp}
              submitLabel="Confirm"
              submittingLabel="Setting up…"
            />
          )}

          {step === "protecting" && (
            <View className="gap-4">
              <Text className="text-foreground text-2xl font-bold">Protecting your history</Text>
              <Text accessibilityLiveRegion="polite" className="text-tertiary text-base">
                {progress.total === 0
                  ? "Checking your groups…"
                  : `Protected ${progress.done} of ${progress.total} groups.`}
              </Text>
            </View>
          )}

          {step === "done" && (
            <View className="gap-4">
              <Text className="text-foreground text-2xl font-bold">Your phrase is set up</Text>
              <Text className="text-secondary text-base">
                Use it to get your location history back if you lose or replace your phone.
              </Text>
              {progress.failed > 0 && (
                <Text className="text-secondary text-base">
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
