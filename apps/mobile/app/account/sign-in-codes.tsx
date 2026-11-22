import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { ConfirmIdentity } from "../../components/ConfirmIdentity.tsx";
import { EmailCodeEntry } from "../../components/EmailCodeEntry.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { MailCheckIcon } from "lucide-react-native";
import { Button } from "../../components/ui/Button.tsx";
import { ListRow, ListSection } from "../../components/ui/List.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useIdentityGate } from "../../hooks/useIdentityGate.ts";
import { Alert } from "../../lib/alert.ts";
import { trpc } from "../../lib/api.ts";
import { errorReason } from "../../lib/errorReason.ts";
import { invalidCodeMessage } from "../../lib/emailCodes.ts";
import { needsFreshSignIn } from "../../lib/needsFreshSignIn.ts";
import { userMessage } from "../../lib/userMessage.ts";

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
      Alert.alert("Couldn’t send a code", userMessage(result.error));
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
      Alert.alert("Couldn’t turn off sign-in codes", userMessage(result.error));
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
      <ScreenHeader title="Sign-in codes" hideBack={step.name === "saving"} />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <ScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-6 px-4 pb-10 pt-2"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="gap-2 px-4">
            <Text className="text-secondary text-[15px] leading-5">
              With sign-in codes on, signing in with your password also needs a 6-digit code we
              email you. Someone who learns your password can’t sign in unless they can also read
              your email.
            </Text>
            <Text className="text-secondary text-[15px] leading-5">
              Phones and tablets that are already signed in stay signed in, and confirming it’s you
              on them still only needs your password.
            </Text>
          </View>

          {status.isPending && <LoadingIndicator />}
          {status.isError && (
            <View className="gap-4">
              <Text>
                We couldn’t load your sign-in codes setting. Check your connection and try again.
              </Text>
              <Button variant="secondary" onPress={() => status.refetch()}>
                <Text>Try again</Text>
              </Button>
            </View>
          )}
          {status.data && !on && !status.data.canTurnOn && (
            <Text className="text-secondary px-1 text-[15px] leading-5">
              Sign-in codes are only for accounts that sign in with a password, on servers that can
              send email.
            </Text>
          )}

          {status.data && (on || status.data.canTurnOn) && (
            <>
              <ListSection>
                <ListRow
                  title="Sign-in codes"
                  icon={MailCheckIcon}
                  iconColor="blue"
                  value={on ? "On" : "Off"}
                  accessibilityLabel={on ? "Sign-in codes are on" : "Sign-in codes are off"}
                />
              </ListSection>

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
                    if (result.error) return userMessage(result.error);
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
                    return result.error ? userMessage(result.error) : undefined;
                  }}
                />
              )}

              {(step.name === "ready" || step.name === "saving") && !on && (
                <Text className="text-tertiary px-4 text-sm leading-5">
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
