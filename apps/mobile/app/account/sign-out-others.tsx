import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { Link, router, useNavigation } from "expo-router";
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
  const navigation = useNavigation();
  const methods = useQuery(trpc.account.deletionVerificationMethods.queryOptions());
  const signOutOthers = useMutation({
    ...trpc.account.signOutOtherSessions.mutationOptions(),
    networkMode: "always",
  });

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
      Alert.alert("Sign in again", "Nothing was signed out. Confirm it’s you, then try again.");
      return;
    }
    if (result.error) {
      setStep("ready");
      Alert.alert(
        "Unable to sign out other sessions",
        result.error instanceof TRPCClientError && result.error.data
          ? result.error.message
          : "Check your connection and try again.",
      );
      return;
    }
    if (navigation.isFocused()) router.back();
    if (result.data.signedOut === 0) {
      Alert.alert("No other sessions", "You weren’t signed in anywhere else.");
      return;
    }
    Alert.alert(
      "Other sessions signed out",
      "Every other session has been signed out. This device is still signed in.",
    );
  };

  const confirmSignOut = () =>
    Alert.alert(
      "Sign out of all other sessions?",
      "Every session except this device will be signed out.",
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
          <Text className="text-foreground text-2xl font-bold">Sign out others</Text>
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
              Each phone or tablet where you’re signed in is a session. This signs out every session
              except this device. Use it if you’ve lost a phone or tablet, or think someone else is
              signed in.
            </Text>
            <Text className="text-muted-foreground text-base leading-6">
              Signed-out phones and tablets still show under Devices on the Account tab, but they
              must sign in again to see anything new.
            </Text>
          </View>

          {methods.data?.password && (
            <View className="gap-4">
              <Text className="text-muted-foreground text-base leading-6">
                If someone else might know your password, change it instead. That signs out your
                other sessions too.
              </Text>
              <Link href="/account/password" replace asChild>
                <Button variant="outline" disabled={step === "signingOut"}>
                  <Text>Change password</Text>
                </Button>
              </Link>
            </View>
          )}
          {methods.data?.password === false && (
            <Text className="text-muted-foreground text-base leading-6">
              If someone else might be using your Google account, change your Google password first,
              or they could sign in again.
            </Text>
          )}

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
