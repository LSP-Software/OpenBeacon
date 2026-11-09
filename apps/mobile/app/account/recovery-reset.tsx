import { Alert } from "../../lib/alert.ts";
import type { RecoveryPhrase } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConfirmIdentity } from "../../components/ConfirmIdentity.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { NewRecoveryPhrase } from "../../components/NewRecoveryPhrase.tsx";
import { RecoveryCoverage } from "../../components/RecoveryCoverage.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useIdentityGate } from "../../hooks/useIdentityGate.ts";
import { trpc } from "../../lib/api.ts";
import { protectHistory } from "../../lib/protectHistory.ts";
import { isResetConfirmed } from "../../lib/isResetConfirmed.ts";
import { resetRecoveryPhrase } from "../../lib/recovery.ts";
import { requestTrackingSync } from "../../lib/trackingEvents.ts";

const RecoveryPhraseResetScreen = () => {
  const { afterSignIn } = useLocalSearchParams<{ afterSignIn?: string }>();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<
    "warn" | "verify" | "phrase" | "saving" | "protecting" | "unsaved" | "done"
  >("warn");
  const gate = useIdentityGate({ enabled: step === "verify" });

  useEffect(() => {
    if (step === "verify" && gate.decision === "ready") {
      setStep("phrase");
    }
  }, [step, gate.decision]);
  const [progress, setProgress] = useState({ done: 0, failed: 0, total: 0 });
  const [userId, setUserId] = useState<string>();
  const form = useForm<{ confirmation: string }>({ defaultValues: { confirmation: "" } });
  const confirmation = useWatch({ control: form.control, name: "confirmation" });

  const reset = async (phrase: RecoveryPhrase) => {
    setStep("saving");
    const result = await tryCatch(resetRecoveryPhrase(phrase));
    if (result.error) {
      setStep("phrase");
      Alert.alert("Unable to reset recovery phrase", result.error.message);
      return;
    }
    if (result.data.status === "reauthenticate") {
      await gate.recheck();
      setStep("verify");
      Alert.alert(
        "Sign in again",
        "Nothing was reset. Confirm it’s you, then write down the new phrase you’re shown.",
      );
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
    await protectHistory({ device, onProgress: setProgress });
    void queryClient.invalidateQueries({ queryKey: ["groupKeyAccess", device.userId] });
    void queryClient.invalidateQueries({ queryKey: ["personalNicknames"] });
    requestTrackingSync();
    setStep("done");
  };

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          {step === "saving" || step === "protecting" ? <View className="w-10" /> : <BackButton />}
          <Text className="text-foreground text-2xl font-bold">Reset phrase</Text>
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
          {step === "warn" && (
            <View className="gap-4">
              <Text className="text-foreground text-3xl font-bold">
                Reset your recovery phrase?
              </Text>
              <Text className="text-muted-foreground text-base leading-6">
                Only do this if you’ve lost your phrase and no other phone can read your history.
              </Text>
              <View className="gap-2 rounded-lg border border-destructive bg-destructive/10 p-4">
                <Text className="font-semibold">
                  Encrypted history from before today can’t be recovered.
                </Text>
                <Text className="text-muted-foreground leading-6">
                  Your old phrase stops working, and the keys it protected are deleted from your
                  account. This phone keeps only the history it can still read with its own keys.
                  Other phones will need the new phrase.
                </Text>
              </View>
              <Text className="text-muted-foreground text-base leading-6">
                Your groups and live location sharing aren’t affected.
              </Text>
              <Input
                control={form.control}
                name="confirmation"
                label="Type RESET to continue"
                autoCapitalize="characters"
                autoCorrect={false}
                spellCheck={false}
              />
              <Button
                variant="destructive"
                onPress={() => setStep("verify")}
                disabled={!isResetConfirmed(confirmation)}
              >
                <Text>Continue</Text>
              </Button>
              <Button variant="outline" onPress={() => router.back()}>
                <Text>Cancel</Text>
              </Button>
            </View>
          )}

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
              onConfirm={reset}
              submitLabel="Reset phrase"
              submittingLabel="Resetting…"
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
              <Text className="text-foreground text-3xl font-bold">Restore your new phrase</Text>
              <Text className="text-muted-foreground text-base leading-6">
                Your new phrase is set up, but this phone couldn’t save its key. Restore with the
                phrase you just wrote down.
              </Text>
              <Button
                onPress={() =>
                  router.replace(
                    afterSignIn
                      ? { pathname: "/account/recovery-restore", params: { afterSignIn: "true" } }
                      : "/account/recovery-restore",
                  )
                }
              >
                <Text>Restore with recovery phrase</Text>
              </Button>
            </View>
          )}

          {step === "done" && (
            <View className="gap-4">
              <Text className="text-foreground text-3xl font-bold">Your phrase is reset</Text>
              <Text className="text-muted-foreground text-base leading-6">
                Use it to get your location history back if you lose or replace your phone.
              </Text>
              {progress.failed > 0 && (
                <Text className="text-muted-foreground text-base leading-6">
                  Some history couldn’t be protected yet. OpenBeacon will keep trying in the
                  background.
                </Text>
              )}
              <RecoveryCoverage userId={userId} />
              <Button onPress={() => (afterSignIn ? router.replace("/") : router.back())}>
                <Text>Done</Text>
              </Button>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default RecoveryPhraseResetScreen;
