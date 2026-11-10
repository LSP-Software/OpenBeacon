import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConfirmIdentity } from "../../components/ConfirmIdentity.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useIdentityGate } from "../../hooks/useIdentityGate.ts";
import { Alert } from "../../lib/alert.ts";
import { trpc } from "../../lib/api.ts";

const SignOutOtherSessionsScreen = () => {
  const [step, setStep] = useState<"verify" | "ready" | "signingOut">("verify");
  const gate = useIdentityGate();
  const methods = useQuery(trpc.account.deletionVerificationMethods.queryOptions());
  const signOutOthers = useMutation(trpc.account.signOutOtherSessions.mutationOptions());

  useEffect(() => {
    if (step === "verify" && gate.decision === "ready") {
      setStep("ready");
    }
  }, [step, gate.decision]);

  const signOut = async () => {
    setStep("signingOut");
    const result = await tryCatch(signOutOthers.mutateAsync());
    if (result.error instanceof TRPCClientError && result.error.data?.code === "FORBIDDEN") {
      await gate.recheck();
      setStep("verify");
      Alert.alert("Sign in again", "No sessions were signed out. Confirm it’s you to carry on.");
      return;
    }
    if (result.error) {
      setStep("ready");
      Alert.alert("Unable to sign out other sessions", result.error.message);
      return;
    }
    router.back();
    Alert.alert(
      "Other sessions signed out",
      result.data.signedOut === 0
        ? "You weren’t signed in anywhere else. This phone is still signed in."
        : "Every other device has been signed out. This phone is still signed in.",
    );
  };

  const confirmSignOut = () =>
    Alert.alert(
      "Sign out of all other sessions?",
      "Every other device signed in to your account will be signed out. This phone stays signed in.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out others", style: "destructive", onPress: signOut },
      ],
    );

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          {step === "signingOut" ? <View className="w-10" /> : <BackButton />}
          <Text className="text-foreground text-2xl font-bold">Other sessions</Text>
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
              Sign out every other phone or tablet that’s signed in to your account. This phone
              stays signed in. Use this if you’ve lost a phone or think someone else is signed in.
            </Text>
            {methods.data && (
              <Text className="text-muted-foreground text-base leading-6">
                {methods.data.password
                  ? "If someone else might know your password, change it in Password and Security instead. That signs out your other devices too."
                  : "If someone else might be using your Google account, change your Google password first, or they could sign in again."}
              </Text>
            )}
          </View>

          {step === "verify" && gate.decision === null && <LoadingIndicator />}
          {step === "verify" && gate.decision === "confirm" && (
            <ConfirmIdentity
              onConfirmed={() => {
                void gate.refresh();
                setStep("ready");
              }}
            />
          )}

          {(step === "ready" || step === "signingOut") && (
            <Button variant="destructive" onPress={confirmSignOut} disabled={step === "signingOut"}>
              <Text>
                {step === "signingOut" ? "Signing out…" : "Sign out of all other sessions"}
              </Text>
            </Button>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default SignOutOtherSessionsScreen;
