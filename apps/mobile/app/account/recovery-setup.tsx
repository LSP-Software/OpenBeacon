import { Alert } from "../../lib/alert.ts";
import type { RecoveryPhrase } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConfirmIdentity } from "../../components/ConfirmIdentity.tsx";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { NewRecoveryPhrase } from "../../components/NewRecoveryPhrase.tsx";
import { RecoveryCoverage } from "../../components/RecoveryCoverage.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useIdentityGate } from "../../hooks/useIdentityGate.ts";
import { trpc } from "../../lib/api.ts";
import { backfillEveryGroup, setUpRecoveryPhrase } from "../../lib/recovery.ts";
import { resealPersonalData } from "../../lib/resealPersonalData.ts";

const RecoveryPhraseSetupScreen = () => {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<
    "verify" | "phrase" | "saving" | "protecting" | "unsaved" | "done"
  >("verify");
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
      Alert.alert("Unable to set up recovery phrase", result.error.message);
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
      router.replace("/account/recovery-restore");
      return;
    }
    const { device } = result.data;
    void queryClient.invalidateQueries({ queryKey: trpc.accountRecovery.status.queryKey() });
    void queryClient.invalidateQueries({ queryKey: ["historyKeyHeld", device.userId] });
    void queryClient.invalidateQueries({ queryKey: ["groupKeyAccess", device.userId] });
    if (result.data.status === "unsaved") {
      setStep("unsaved");
      return;
    }
    setUserId(device.userId);
    setStep("protecting");
    await backfillEveryGroup({ device, onProgress: setProgress });
    await queryClient.invalidateQueries({ queryKey: ["groupKeyAccess", device.userId] });
    await resealPersonalData(device.userId);
    await queryClient.invalidateQueries({ queryKey: ["personalNicknames"] });
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
              <Text className="text-foreground text-3xl font-bold">Protecting your history</Text>
              <Text accessibilityLiveRegion="polite" className="text-muted-foreground text-base">
                {progress.total === 0
                  ? "Checking your groups…"
                  : `Protected ${progress.done} of ${progress.total} groups.`}
              </Text>
            </View>
          )}

          {step === "unsaved" && (
            <View className="gap-4">
              <Text className="text-foreground text-3xl font-bold">Restore your phrase</Text>
              <Text className="text-muted-foreground text-base leading-6">
                Your phrase is set up, but this phone couldn’t save its key. Restore with the phrase
                you just wrote down.
              </Text>
              <Button onPress={() => router.replace("/account/recovery-restore")}>
                <Text>Restore with recovery phrase</Text>
              </Button>
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
