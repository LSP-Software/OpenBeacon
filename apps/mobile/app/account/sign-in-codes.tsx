import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { router, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConfirmIdentity } from "../../components/ConfirmIdentity.tsx";
import { EmailCodeEntry } from "../../components/EmailCodeEntry.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useIdentityGate } from "../../hooks/useIdentityGate.ts";
import { Alert } from "../../lib/alert.ts";
import { trpc } from "../../lib/api.ts";
import { errorReason } from "../../lib/errorReason.ts";
import { invalidCodeMessage } from "../../lib/emailCodes.ts";
import { needsFreshSignIn } from "../../lib/needsFreshSignIn.ts";

const SignInCodesScreen = () => {
  const [step, setStep] = useState<
    { name: "verify" } | { name: "ready" } | { name: "code"; email: string } | { name: "saving" }
  >({ name: "verify" });
  const gate = useIdentityGate();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const status = useQuery(trpc.signInCodes.status.queryOptions());
  const requestCode = useMutation(trpc.signInCodes.requestTurnOnCode.mutationOptions());
  const turnOn = useMutation(trpc.signInCodes.turnOn.mutationOptions());
  const turnOff = useMutation(trpc.signInCodes.turnOff.mutationOptions());

  useEffect(() => {
    if (step.name === "verify" && gate.decision === "ready") setStep({ name: "ready" });
  }, [step.name, gate.decision]);

  const errorMessage = (error: unknown) =>
    error instanceof TRPCClientError && error.data
      ? error.message
      : "Check your connection and try again.";

  const confirmAgain = async () => {
    await gate.recheck();
    setStep({ name: "verify" });
    Alert.alert("Sign in again", "Nothing was changed. Confirm it’s you, then try again.");
  };

  const finish = async (title: string, message: string) => {
    await queryClient.invalidateQueries({ queryKey: trpc.signInCodes.status.queryKey() });
    if (navigation.isFocused()) router.back();
    Alert.alert(title, message);
  };

  const sendCode = async () => {
    setStep({ name: "saving" });
    const result = await tryCatch(requestCode.mutateAsync());
    if (needsFreshSignIn(result.error)) return confirmAgain();
    if (result.error) {
      setStep({ name: "ready" });
      Alert.alert("Couldn’t send a code", errorMessage(result.error));
      return;
    }
    setStep({ name: "code", email: result.data.email });
  };

  const switchOff = async () => {
    setStep({ name: "saving" });
    const result = await tryCatch(turnOff.mutateAsync());
    if (needsFreshSignIn(result.error)) return confirmAgain();
    if (result.error) {
      setStep({ name: "ready" });
      Alert.alert("Couldn’t turn off sign-in codes", errorMessage(result.error));
      return;
    }
    await finish("Sign-in codes are off", "Signing in now only needs your password.");
  };

  const confirmSwitchOff = () =>
    Alert.alert(
      "Turn off sign-in codes?",
      "Anyone who knows your password will be able to sign in without a code from your email.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Turn off", style: "destructive", onPress: switchOff },
      ],
    );

  const on = status.data?.on === true;

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          {step.name === "saving" ? <View className="w-10" /> : <BackButton />}
          <Text className="text-foreground text-2xl font-bold">Sign-in codes</Text>
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
          <View className="gap-2">
            <Text className="text-muted-foreground text-base leading-6">
              With sign-in codes on, signing in with your password also needs a 6-digit code we
              email you. Someone who learns your password can’t sign in unless they can also read
              your email.
            </Text>
            <Text className="text-muted-foreground text-base leading-6">
              Phones and tablets that are already signed in stay signed in, and confirming it’s you
              on them still only needs your password.
            </Text>
          </View>

          {status.isLoading && <LoadingIndicator />}
          {status.isError && (
            <View className="gap-4">
              <Text>
                We couldn’t load your sign-in codes setting. Check your connection and try again.
              </Text>
              <Button variant="outline" onPress={() => status.refetch()}>
                <Text>Try again</Text>
              </Button>
            </View>
          )}
          {status.data && !on && !status.data.canTurnOn && (
            <Text className="text-muted-foreground text-base leading-6">
              Sign-in codes are only for accounts that sign in with a password, on servers that can
              send email.
            </Text>
          )}

          {status.data && (on || status.data.canTurnOn) && (
            <>
              <Text className="text-foreground text-lg font-semibold">
                {on ? "Sign-in codes are on" : "Sign-in codes are off"}
              </Text>

              {step.name === "verify" && gate.decision === null && <LoadingIndicator />}
              {step.name === "verify" && gate.decision === "confirm" && (
                <ConfirmIdentity
                  onConfirmed={() => {
                    void gate.refresh();
                    setStep({ name: "ready" });
                  }}
                />
              )}

              {step.name === "code" && (
                <EmailCodeEntry
                  email={step.email}
                  submitLabel="Turn on sign-in codes"
                  onSubmit={async (code) => {
                    const result = await tryCatch(turnOn.mutateAsync({ code }));
                    if (needsFreshSignIn(result.error)) {
                      await confirmAgain();
                      return undefined;
                    }
                    if (errorReason(result.error) === "INVALID_CODE") return invalidCodeMessage;
                    if (result.error) return errorMessage(result.error);
                    await finish(
                      "Sign-in codes are on",
                      "Next time you sign in with your password, we’ll email you a code.",
                    );
                    return undefined;
                  }}
                  onResend={async () => {
                    const result = await tryCatch(requestCode.mutateAsync());
                    if (needsFreshSignIn(result.error)) {
                      await confirmAgain();
                      return undefined;
                    }
                    return result.error ? errorMessage(result.error) : undefined;
                  }}
                />
              )}

              {(step.name === "ready" || step.name === "saving") && !on && (
                <Text className="text-muted-foreground text-sm leading-5">
                  We’ll email you a code first to check it arrives.
                </Text>
              )}
              {(step.name === "ready" || step.name === "saving") &&
                (on ? (
                  <Button
                    variant="destructive"
                    onPress={confirmSwitchOff}
                    disabled={step.name === "saving"}
                  >
                    <Text>
                      {step.name === "saving" ? "Turning off…" : "Turn off sign-in codes"}
                    </Text>
                  </Button>
                ) : (
                  <Button onPress={sendCode} disabled={step.name === "saving"}>
                    <Text>{step.name === "saving" ? "Sending a code…" : "Email me a code"}</Text>
                  </Button>
                ))}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default SignInCodesScreen;
