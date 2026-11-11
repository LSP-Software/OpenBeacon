import { Alert } from "../../lib/alert.ts";
import { diagnoseRecoveryPhraseInput, parseRecoveryPhrase } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { Link, router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  allowScreenCaptureAsync,
  disableAppSwitcherProtectionAsync,
  enableAppSwitcherProtectionAsync,
  preventScreenCaptureAsync,
} from "expo-screen-capture";
import { useCallback, useEffect, useState } from "react";
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { RecoveryPhraseGrid } from "../../components/RecoveryPhraseGrid.tsx";
import { RecoveryCoverage } from "../../components/RecoveryCoverage.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useHeldHistoryKeyVersions } from "../../hooks/useHeldHistoryKeyVersions.ts";
import { trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { activateWithHistoryKey } from "../../lib/deviceActivation.ts";
import { restoreFromRecoveryPhrase } from "../../lib/recovery.ts";
import { requestTrackingSync } from "../../lib/trackingEvents.ts";
import { resealPersonalData } from "../../lib/resealPersonalData.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const emptyWords = () => Array.from({ length: 12 }, () => "");

const RecoveryRestoreScreen = () => {
  const { setup } = useLocalSearchParams<{ setup?: string }>();
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();
  const status = useQuery(trpc.accountRecovery.status.queryOptions());
  const currentVersion = status.data?.currentHistoryKey?.version;
  const heldVersions = useHeldHistoryKeyVersions(
    session?.user.id,
    status.data?.currentHistoryKey ?? undefined,
  );
  const holdsCurrent = currentVersion !== undefined && heldVersions.data?.includes(currentVersion);
  const [step, setStep] = useState<
    "enter" | "restoring" | "activating" | "activationFailed" | "done"
  >("enter");
  const [userId, setUserId] = useState<string>();
  const [words, setWords] = useState(emptyWords);
  const [problem, setProblem] = useState<{ message: string; invalidIndexes: number[] }>();
  const [activationProblem, setActivationProblem] = useState<string>();

  const entering = step === "enter" || step === "restoring";
  const busy = step === "restoring" || step === "activating";

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => busy);
      return () => subscription.remove();
    }, [busy]),
  );
  const protecting = step !== "done";
  useEffect(() => {
    if (!protecting) return;
    void tryCatch(preventScreenCaptureAsync("recovery-restore"));
    void tryCatch(enableAppSwitcherProtectionAsync());
    return () => {
      void tryCatch(allowScreenCaptureAsync("recovery-restore"));
      void tryCatch(disableAppSwitcherProtectionAsync());
    };
  }, [protecting]);

  const restore = async () => {
    setProblem(undefined);
    if (words.some((word) => word === "")) {
      setProblem({ message: "Enter all 12 words.", invalidIndexes: [] });
      return;
    }
    const input = words.join(" ");
    const parsed = await tryCatch(Promise.resolve().then(() => parseRecoveryPhrase(input)));
    if (parsed.error) {
      const diagnosis = diagnoseRecoveryPhraseInput(input);
      if (diagnosis.problem === "unknown-words") {
        const { positions } = diagnosis;
        setProblem({
          message:
            positions.length === 1
              ? `Word ${positions[0]} isn’t in the recovery word list. Check its spelling.`
              : `Words ${positions.slice(0, -1).join(", ")} and ${positions.at(-1)} aren’t in the recovery word list. Check their spelling.`,
          invalidIndexes: positions.map((position) => position - 1),
        });
      } else {
        setProblem({
          message:
            "The words are all valid, but they don’t make a recovery phrase. Check they’re in the right order.",
          invalidIndexes: [],
        });
      }
      return;
    }
    setStep("restoring");
    const result = await tryCatch(restoreFromRecoveryPhrase(parsed.data));
    if (result.error) {
      setStep("enter");
      Alert.alert("Unable to restore", result.error.message);
      return;
    }
    setWords(emptyWords());
    setUserId(result.data.userId);
    void queryClient.invalidateQueries({ queryKey: trpc.accountRecovery.status.queryKey() });
    void queryClient.invalidateQueries({ queryKey: ["historyKeyHeld", result.data.userId] });
    void queryClient.invalidateQueries({ queryKey: ["groupKeyAccess", result.data.userId] });
    await finish(result.data.userId);
  };

  const finish = async (restoredUserId: string) => {
    if (setup) {
      setStep("activating");
      setActivationProblem(undefined);
      const activated = await tryCatch(activateWithHistoryKey());
      if (activated.error) {
        setActivationProblem(
          activated.error instanceof TRPCClientError && !activated.error.data
            ? "We couldn’t reach the server. Check your connection and try again."
            : activated.error.message,
        );
        setStep("activationFailed");
        return;
      }
    }
    requestTrackingSync();
    await resealPersonalData(restoredUserId);
    await queryClient.invalidateQueries({ queryKey: ["personalNicknames"] });
    if (setup) {
      router.replace("/setup/name");
      return;
    }
    setStep("done");
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ gestureEnabled: !busy }} />
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          {busy ? <View className="w-10" /> : <BackButton />}
          <Text className="text-foreground text-2xl font-bold">Restore</Text>
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
          {entering && (
            <View className="gap-4">
              <Text className="text-foreground text-3xl font-bold">Restore your history</Text>
              <Text className="text-muted-foreground text-base leading-6">
                {setup
                  ? `Enter the 12 words of your recovery phrase to set up this ${thisDeviceNoun()}. It then gets your groups’ location history too.`
                  : `Your account has a recovery phrase. Enter its 12 words to read your groups’ location history on this ${thisDeviceNoun()}.`}
              </Text>
              <RecoveryPhraseGrid
                words={words}
                onChangeWords={(next) => {
                  setWords(next);
                  setProblem(undefined);
                }}
                onSubmit={restore}
                invalidIndexes={problem?.invalidIndexes}
                editable={step === "enter"}
              />
              {problem && (
                <Text className="text-destructive text-sm leading-5">{problem.message}</Text>
              )}
              <Button onPress={restore} disabled={step === "restoring"}>
                <Text>{step === "restoring" ? "Restoring…" : "Restore"}</Text>
              </Button>
              {!holdsCurrent && (
                <Link
                  href={
                    setup
                      ? { pathname: "/account/recovery-reset", params: { setup: "true" } }
                      : "/account/recovery-reset"
                  }
                  replace
                  asChild
                >
                  <Button variant="ghost" disabled={step === "restoring"}>
                    <Text>I’ve lost my phrase</Text>
                  </Button>
                </Link>
              )}
            </View>
          )}

          {(step === "activating" || step === "activationFailed") && userId && (
            <View className="gap-4">
              <Text className="text-foreground text-3xl font-bold">Your history is restored</Text>
              <Text
                accessibilityLiveRegion="polite"
                className={
                  activationProblem
                    ? "text-destructive text-base leading-6"
                    : "text-muted-foreground text-base leading-6"
                }
              >
                {activationProblem ?? `Setting up this ${thisDeviceNoun()}…`}
              </Text>
              <Button onPress={() => finish(userId)} loading={step === "activating"}>
                <Text>Try again</Text>
              </Button>
            </View>
          )}

          {step === "done" && (
            <View className="gap-4">
              <Text className="text-foreground text-3xl font-bold">Your history is restored</Text>
              <Text className="text-muted-foreground text-base leading-6">
                This phone can now read the history your recovery phrase protects.
              </Text>
              <RecoveryCoverage userId={userId} />
              <Button onPress={() => router.back()}>
                <Text>Continue</Text>
              </Button>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default RecoveryRestoreScreen;
