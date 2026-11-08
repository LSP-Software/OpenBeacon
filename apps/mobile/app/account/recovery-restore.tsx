import { Alert } from "../../lib/alert.ts";
import { diagnoseRecoveryPhraseInput, parseRecoveryPhrase } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, router, useLocalSearchParams } from "expo-router";
import {
  allowScreenCaptureAsync,
  disableAppSwitcherProtectionAsync,
  enableAppSwitcherProtectionAsync,
  preventScreenCaptureAsync,
} from "expo-screen-capture";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { RecoveryPhraseGrid } from "../../components/RecoveryPhraseGrid.tsx";
import { RecoveryCoverage } from "../../components/RecoveryCoverage.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { restoreFromRecoveryPhrase } from "../../lib/recovery.ts";
import { storage } from "../../lib/storage.ts";
import { requestTrackingSync } from "../../lib/trackingEvents.ts";
import { resealPersonalData } from "../../lib/resealPersonalData.ts";

const emptyWords = () => Array.from({ length: 12 }, () => "");

const RecoveryRestoreScreen = () => {
  const { afterSignIn, missingVersion } = useLocalSearchParams<{
    afterSignIn?: string;
    missingVersion?: string;
  }>();
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();
  const status = useQuery(trpc.accountRecovery.status.queryOptions());
  const [step, setStep] = useState<"enter" | "restoring" | "done">("enter");
  const [userId, setUserId] = useState<string>();
  const [words, setWords] = useState(emptyWords);
  const [problem, setProblem] = useState<{ message: string; invalidIndexes: number[] }>();

  const entering = step !== "done";
  useEffect(() => {
    if (!entering) return;
    void tryCatch(preventScreenCaptureAsync("recovery-restore"));
    void tryCatch(enableAppSwitcherProtectionAsync());
    return () => {
      void tryCatch(allowScreenCaptureAsync("recovery-restore"));
      void tryCatch(disableAppSwitcherProtectionAsync());
    };
  }, [entering]);

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
    requestTrackingSync();
    await resealPersonalData(result.data.userId);
    await queryClient.invalidateQueries({ queryKey: ["personalNicknames"] });
    setStep("done");
  };

  const skip = () => {
    const version = missingVersion
      ? Number(missingVersion)
      : status.data?.currentHistoryKey?.version;
    if (session?.user.id && version) {
      storage.set(`recovery.restoreDeclined.${session.user.id}`, version);
    }
    router.replace("/");
  };

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          {afterSignIn || step === "restoring" ? <View className="w-10" /> : <BackButton />}
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
                Your account has a recovery phrase. Enter its 12 words to read your groups’ location
                history on this phone.
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
              {afterSignIn && (
                <View className="gap-2">
                  <Button variant="outline" onPress={skip} disabled={step === "restoring"}>
                    <Text>Skip for now</Text>
                  </Button>
                  <Link
                    href={{ pathname: "/account/recovery-reset", params: { afterSignIn: "true" } }}
                    asChild
                  >
                    <Button variant="ghost" disabled={step === "restoring"}>
                      <Text>I’ve lost my phrase</Text>
                    </Button>
                  </Link>
                  <Text className="text-muted-foreground text-sm leading-5">
                    If you skip, this phone shares your live location once another member’s phone
                    updates your groups’ keys, which happens automatically. You can restore later
                    from Account › Recovery phrase.
                  </Text>
                </View>
              )}
            </View>
          )}

          {step === "done" && (
            <View className="gap-4">
              <Text className="text-foreground text-3xl font-bold">Your history is restored</Text>
              <Text className="text-muted-foreground text-base leading-6">
                This phone can now read the history your recovery phrase protects.
              </Text>
              <RecoveryCoverage userId={userId} />
              <Button onPress={() => (afterSignIn ? router.replace("/") : router.back())}>
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
