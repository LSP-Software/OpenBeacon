import { Alert } from "../lib/alert.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { signInSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { z } from "zod";
import { AnnouncementBanner } from "../components/AnnouncementBanner.tsx";
import { EmailCodeEntry } from "../components/EmailCodeEntry.tsx";
import { KeyboardFormScrollView } from "../components/KeyboardFormScrollView.tsx";
import { HeldKeysNotice } from "../components/HeldKeysNotice.tsx";
import { ReturnToHomeHeader } from "../components/headers/ReturnToHomeHeader.tsx";
import { ServerNotice } from "../components/ServerNotice.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Input } from "../components/ui/Input.tsx";
import { Text } from "../components/ui/Text.tsx";
import { trpc } from "../lib/api.ts";
import { completeAuthenticatedSessionSetup, isNativeGoogleSignInConfigured } from "../lib/auth.ts";
import {
  emailCodeErrorMessage,
  emailCodes,
  readSignInError,
  signInCodeEntryError,
  signInWithPassword,
} from "../lib/emailCodes.ts";
import { finishAuthentication } from "../lib/finishAuthentication.ts";
import { performGoogleAuth } from "../lib/googleAuth.ts";

type PendingSignIn = z.infer<typeof signInSchema> & { notice: string | undefined };

const SignIn = () => {
  const { joinCode, email: emailParam } = useLocalSearchParams<{
    joinCode?: string;
    email?: string;
  }>();
  const finishSignIn = () => finishAuthentication({ joinCode });
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const { data: providers } = useQuery(trpc.auth.providers.queryOptions());
  const [unverified, setUnverified] = useState<PendingSignIn | null>(null);
  const [signInCode, setSignInCode] = useState<PendingSignIn | null>(null);

  const form = useForm<z.infer<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    mode: "onTouched",
    defaultValues: {
      email: emailParam ?? "",
      password: "",
    },
    shouldFocusError: true,
  });

  const isSubmitting = emailLoading || googleLoading;
  const isGoogleEnabled = providers?.google === true && isNativeGoogleSignInConfigured;
  const enteredEmail = form.watch("email");

  const handleLogin = async ({
    email,
    password,
    code,
  }: z.infer<typeof signInSchema> & { code?: string | undefined }) => {
    setEmailLoading(true);

    const result = await tryCatch(signInWithPassword({ email, password, code }));
    const outcome = readSignInError(result.error ?? result.data.error);
    if (outcome.kind === "codeRequired") {
      setEmailLoading(false);
      setSignInCode({ email, password, notice: outcome.notice });
      return outcome;
    }
    if (outcome.kind !== "signedIn") {
      setEmailLoading(false);
      return outcome;
    }

    const sessionSetupResult = await completeAuthenticatedSessionSetup();
    if (sessionSetupResult.deviceRemoved) {
      setEmailLoading(false);
      return outcome;
    }
    if (sessionSetupResult.error) {
      Alert.alert("Couldn’t finish sign in", sessionSetupResult.error.message);
      setEmailLoading(false);
      return outcome;
    }

    await finishSignIn();
    return outcome;
  };

  const askToVerifyEmail = async ({ email, password }: z.infer<typeof signInSchema>) => {
    setEmailLoading(true);
    const requested = await emailCodes.requestEmailVerification(email, password);
    setEmailLoading(false);
    if (requested.error && requested.error.status !== 429) {
      Alert.alert("Couldn’t send a code", emailCodeErrorMessage(requested.error));
      return;
    }
    setSignInCode(null);
    setUnverified({
      email,
      password,
      notice: requested.error ? emailCodeErrorMessage(requested.error) : undefined,
    });
  };

  const signInWithForm = async (values: z.infer<typeof signInSchema>) => {
    const outcome = await handleLogin(values);
    if (outcome.kind === "failed" && outcome.code === "EMAIL_NOT_VERIFIED") {
      await askToVerifyEmail(values);
      return;
    }
    if (outcome.kind === "wrongPassword" || outcome.kind === "failed") {
      Alert.alert("Couldn’t sign in", outcome.message);
    }
  };

  const continueWithCode = async (pending: PendingSignIn, code?: string) => {
    const outcome = await handleLogin({ email: pending.email, password: pending.password, code });
    if (outcome.kind === "wrongPassword") {
      setSignInCode(null);
      form.setValue("password", "");
      Alert.alert("Couldn’t sign in", outcome.message);
      return undefined;
    }
    if (outcome.kind === "failed" && outcome.code === "EMAIL_NOT_VERIFIED") {
      await askToVerifyEmail(pending);
      return undefined;
    }
    return signInCodeEntryError(outcome, code !== undefined);
  };

  const handleGoogleSignIn = async () => {
    await performGoogleAuth({
      setLoading: setGoogleLoading,
      failureTitle: "Couldn’t sign in with Google",
      onSuccess: finishSignIn,
      alert: Alert.alert,
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardFormScrollView contentContainerClassName="gap-6 px-6 pb-6 pt-1">
        {(formProps) => (
          <>
            <ReturnToHomeHeader />
            <AnnouncementBanner />
            <HeldKeysNotice />
            <View className="gap-2">
              <Text accessibilityRole="header" className="text-3xl font-bold">
                {unverified
                  ? "Verify your email"
                  : signInCode
                    ? "Check your email"
                    : "Welcome back"}
              </Text>
              <Text className="text-secondary text-base">
                {unverified
                  ? "Confirm your email address to finish signing in"
                  : signInCode
                    ? "Your account asks for a code when you sign in"
                    : "Sign in to your account"}
              </Text>
            </View>
            <ServerNotice />
            {signInCode ? (
              <View className="gap-4" {...formProps}>
                <EmailCodeEntry
                  email={signInCode.email}
                  notice={signInCode.notice}
                  submitLabel="Sign in"
                  onSubmit={(code) => continueWithCode(signInCode, code)}
                  onResend={() => continueWithCode(signInCode)}
                />
                <Pressable
                  className="items-center py-1"
                  onPress={() => setSignInCode(null)}
                  disabled={emailLoading}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: emailLoading }}
                >
                  <Text className={emailLoading ? "text-secondary" : "text-secondary"}>
                    Back to sign in
                  </Text>
                </Pressable>
              </View>
            ) : unverified ? (
              <View className="gap-4" {...formProps}>
                <EmailCodeEntry
                  email={unverified.email}
                  notice={unverified.notice}
                  submitLabel="Verify and sign in"
                  repeatedInvalidCodeHint="If new codes keep being rejected, wait a few hours and try again, or go back and reset your password, which also confirms your email."
                  onSubmit={async (code) => {
                    const result = await emailCodes.verifyEmail(unverified.email, code);
                    if (result.error) return emailCodeErrorMessage(result.error);
                    await signInWithForm(unverified);
                    setUnverified(null);
                    return undefined;
                  }}
                  onResend={async () => {
                    const result = await emailCodes.requestEmailVerification(
                      unverified.email,
                      unverified.password,
                    );
                    return result.error ? emailCodeErrorMessage(result.error) : undefined;
                  }}
                />
                <Pressable
                  className="items-center py-1"
                  onPress={() => setUnverified(null)}
                  accessibilityRole="button"
                >
                  <Text className="text-secondary">Back to sign in</Text>
                </Pressable>
              </View>
            ) : (
              <View className="gap-5" {...formProps}>
                {isGoogleEnabled ? (
                  <>
                    <Button
                      variant="secondary"
                      onPress={handleGoogleSignIn}
                      loading={googleLoading}
                      disabled={isSubmitting || googleLoading}
                    >
                      <Text>Continue with Google</Text>
                    </Button>
                    <View className="flex-row items-center gap-4">
                      <View className="flex-1 h-px bg-border" />
                      <Text className="text-secondary text-sm">or</Text>
                      <View className="flex-1 h-px bg-border" />
                    </View>
                  </>
                ) : null}
                <Input
                  control={form.control}
                  name="email"
                  label="Email"
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="username"
                  returnKeyType="next"
                />
                <Input
                  control={form.control}
                  name="password"
                  label="Password"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="password"
                  textContentType="password"
                  returnKeyType="done"
                  onSubmitEditing={isSubmitting ? undefined : form.handleSubmit(signInWithForm)}
                />
                {providers?.email ? (
                  <Link
                    href={{
                      pathname: "/forgotPassword",
                      params: { joinCode, email: enteredEmail },
                    }}
                    replace
                    asChild
                  >
                    <Pressable className="self-end py-1" accessibilityRole="link">
                      <Text className="font-semibold text-primary-text">Forgot password?</Text>
                    </Pressable>
                  </Link>
                ) : null}
                <Button onPress={form.handleSubmit(signInWithForm)} disabled={isSubmitting}>
                  <Text>{emailLoading ? "Signing in…" : "Sign in"}</Text>
                </Button>
              </View>
            )}
            <View className="items-center gap-4 pt-2">
              <Link href={{ pathname: "/signUp", params: { joinCode } }} replace asChild>
                <Pressable accessibilityRole="link">
                  <Text className="text-secondary">
                    Don’t have an account?{" "}
                    <Text className="font-semibold text-primary-text">Create one</Text>
                  </Text>
                </Pressable>
              </Link>
              <Pressable
                className="py-1"
                onPress={() => router.push("/serverUrl")}
                accessibilityRole="button"
              >
                <Text className="text-secondary">Using a self-hosted server?</Text>
              </Pressable>
            </View>
          </>
        )}
      </KeyboardFormScrollView>
    </SafeAreaView>
  );
};

export default SignIn;
