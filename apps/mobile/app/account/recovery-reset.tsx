import { Alert } from "../../lib/alert.ts";
import type { RecoveryPhrase } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConfirmIdentity } from "../../components/ConfirmIdentity.tsx";
import { EmailCodeEntry } from "../../components/EmailCodeEntry.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { NewRecoveryPhrase } from "../../components/NewRecoveryPhrase.tsx";
import { RecoveryCoverage } from "../../components/RecoveryCoverage.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useIdentityGate } from "../../hooks/useIdentityGate.ts";
import { trpc } from "../../lib/api.ts";
import { invalidCodeMessage } from "../../lib/emailCodes.ts";
import { protectHistory } from "../../lib/protectHistory.ts";
import { isResetConfirmed } from "../../lib/isResetConfirmed.ts";
import {
  requestRecoveryResetCode,
  resetRecoveryPhrase,
  verifyRecoveryResetCode,
} from "../../lib/recovery.ts";
import { requestTrackingSync } from "../../lib/trackingEvents.ts";

const RecoveryPhraseResetScreen = () => {
  const { setup } = useLocalSearchParams<{ setup?: string }>();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<
    "warn" | "verify" | "code" | "phrase" | "saving" | "protecting" | "unsaved" | "done"
  >("warn");
  const {
    data: providers,
    isPending: providersPending,
    refetch: refetchProviders,
  } = useQuery(trpc.auth.providers.queryOptions());
  const [codeEmail, setCodeEmail] = useState<string>();
  const [resetToken, setResetToken] = useState<string>();
  const gate = useIdentityGate({ enabled: step === "verify" });

  const reauthenticate = async () => {
    await gate.recheck();
    setStep("verify");
    Alert.alert("Sign in again", "Nothing was reset. Confirm it’s you to carry on.");
  };

  const sendCode = async () => {
    const result = await tryCatch(requestRecoveryResetCode());
    if (result.error) return result.error.message;
    if (result.data.status === "reauthenticate") {
      await reauthenticate();
      return undefined;
    }
    setCodeEmail(result.data.email);
    return undefined;
  };

  const startCodeStep = async () => {
    setCodeEmail(undefined);
    setResetToken(undefined);
    setStep("code");
    const error = await sendCode();
    if (!error) return true;
    setStep("warn");
    Alert.alert("Unable to send a code", error);
    return false;
  };

  const continueAfterIdentity = async () => {
    if (!providers?.email || resetToken) {
      setStep("phrase");
      return;
    }
    await startCodeStep();
  };

  const verifyCode = async (code: string) => {
    const result = await tryCatch(verifyRecoveryResetCode(code));
    if (result.error) return result.error.message;
    if (result.data.status === "invalidCode") return invalidCodeMessage;
    if (result.data.status === "reauthenticate") {
      await reauthenticate();
      return undefined;
    }
    setResetToken(result.data.resetToken);
    setStep("phrase");
    return undefined;
  };

  useEffect(() => {
    if (step === "verify" && gate.decision === "ready") {
      void continueAfterIdentity();
    }
  }, [step, gate.decision]);
  const [progress, setProgress] = useState({ done: 0, failed: 0, total: 0 });
  const [userId, setUserId] = useState<string>();
  const form = useForm<{ confirmation: string }>({ defaultValues: { confirmation: "" } });
  const confirmation = useWatch({ control: form.control, name: "confirmation" });

  const reset = async (phrase: RecoveryPhrase) => {
    setStep("saving");
    const result = await tryCatch(resetRecoveryPhrase(phrase, resetToken));
    if (result.error) {
      setStep("phrase");
      Alert.alert("Unable to reset recovery phrase", result.error.message);
      return;
    }
    if (result.data.status === "reauthenticate") {
      await reauthenticate();
      return;
    }
    if (result.data.status === "confirmationExpired") {
      if (await startCodeStep()) {
        Alert.alert(
          "Confirm your email again",
          "Nothing was reset because your email confirmation expired. Enter the new code we’ve sent, then write down the new phrase you’re shown.",
        );
      }
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
    if (setup) {
      router.replace("/setup/remove-devices");
      return;
    }
    setStep("done");
  };

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          {step === "saving" || step === "protecting" ? <View className="w-10" /> : <BackButton />}
          <Text className="text-foreground text-2xl font-bold">
            {setup ? "Start fresh" : "Reset phrase"}
          </Text>
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
          {step === "warn" && setup && (
            <View className="gap-4">
              <Text className="text-foreground text-3xl font-bold">Start fresh on this phone?</Text>
              <View className="gap-2 rounded-lg border border-destructive bg-destructive/10 p-4">
                <Text className="font-semibold">
                  Your location history from before today will be deleted for good.
                </Text>
                <Text className="text-muted-foreground leading-6">
                  Your groups and members stay. You’ll get a new recovery phrase, and this phone is
                  set up straight away. Your other phones keep working but will need the new phrase
                  to read history.
                </Text>
              </View>
            </View>
          )}

          {step === "warn" && !setup && (
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
            </View>
          )}

          {step === "warn" && (
            <View className="gap-4">
              {providers?.email && (
                <Text className="text-muted-foreground text-base leading-6">
                  To make sure it’s you, we’ll email you a code before you get your new phrase.
                </Text>
              )}
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
                onPress={() => {
                  if (providers) {
                    setStep("verify");
                    return;
                  }
                  void refetchProviders();
                  Alert.alert(
                    "Unable to continue",
                    "We couldn’t reach your server. Check your connection and try again.",
                  );
                }}
                disabled={!isResetConfirmed(confirmation) || providersPending}
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
                void continueAfterIdentity();
              }}
            />
          )}

          {step === "code" && !codeEmail && <LoadingIndicator />}
          {step === "code" && codeEmail && (
            <View className="gap-4">
              <Text className="text-foreground text-3xl font-bold">Check your email</Text>
              <EmailCodeEntry
                email={codeEmail}
                submitLabel="Continue"
                onSubmit={verifyCode}
                onResend={sendCode}
              />
            </View>
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
                    setup
                      ? { pathname: "/account/recovery-restore", params: { setup: "true" } }
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

export default RecoveryPhraseResetScreen;
