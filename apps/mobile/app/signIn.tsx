import { Alert } from "../lib/alert.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { signInSchema } from "@openbeacon/schemas";
import { useQuery } from "@tanstack/react-query";
import { Link, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { z } from "zod";
import { EmailCodeEntry } from "../components/EmailCodeEntry.tsx";
import { KeyboardFormScrollView } from "../components/KeyboardFormScrollView.tsx";
import { ReturnToHomeHeader } from "../components/headers/ReturnToHomeHeader.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Input } from "../components/ui/Input.tsx";
import { Text } from "../components/ui/Text.tsx";
import { trpc } from "../lib/api.ts";
import { completeAuthenticatedSessionSetup, isNativeGoogleSignInConfigured } from "../lib/auth.ts";
import { authClient } from "../lib/auth-client.ts";
import { emailCodeErrorMessage, emailCodes } from "../lib/emailCodes.ts";
import { finishAuthentication } from "../lib/finishAuthentication.ts";
import { performGoogleAuth } from "../lib/googleAuth.ts";
import { passwordErrorMessage } from "../lib/passwordErrorMessage.ts";

const SignIn = () => {
  const { joinCode, email: emailParam } = useLocalSearchParams<{
    joinCode?: string;
    email?: string;
  }>();
  const finishSignIn = () => finishAuthentication({ joinCode });
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const { data: providers } = useQuery(trpc.auth.providers.queryOptions());
  const [unverified, setUnverified] = useState<
    (z.infer<typeof signInSchema> & { notice: string | undefined }) | null
  >(null);

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

  const handleLogin = async ({ email, password }: z.infer<typeof signInSchema>) => {
    setEmailLoading(true);

    const result = await authClient.signIn.email({ email, password });
    if (result.error?.code === "EMAIL_NOT_VERIFIED") {
      const requested = await emailCodes.requestEmailVerification(email, password);
      setEmailLoading(false);
      if (requested.error && requested.error.status !== 429) {
        Alert.alert("Couldn't send a code", emailCodeErrorMessage(requested.error));
        return;
      }
      setUnverified({
        email,
        password,
        notice: requested.error ? emailCodeErrorMessage(requested.error) : undefined,
      });
      return;
    }
    if (result.error) {
      Alert.alert("Sign in failed", passwordErrorMessage(result.error, "Please try again."));
      setEmailLoading(false);
      return;
    }

    const sessionSetupResult = await completeAuthenticatedSessionSetup();
    if (sessionSetupResult.deviceRemoved) {
      setEmailLoading(false);
      return;
    }
    if (sessionSetupResult.error) {
      Alert.alert("Unable to finish sign in", sessionSetupResult.error.message);
      setEmailLoading(false);
      return;
    }

    await finishSignIn();
  };

  const handleGoogleSignIn = async () => {
    await performGoogleAuth({
      setLoading: setGoogleLoading,
      failureTitle: "Google sign in failed",
      onSuccess: finishSignIn,
      alert: Alert.alert,
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardFormScrollView contentContainerClassName="px-8 pt-2 pb-6 gap-6">
        {(formProps) => (
          <>
            <ReturnToHomeHeader />
            <View className="gap-2">
              <Text className="font-bold text-5xl">
                {unverified ? "Verify your\nemail." : "Welcome\nback."}
              </Text>
              <Text className="text-lg text-muted">
                {unverified
                  ? "Confirm your email address to finish signing in"
                  : "Sign in to your account"}
              </Text>
            </View>
            {unverified ? (
              <View className="gap-4" {...formProps}>
                <EmailCodeEntry
                  email={unverified.email}
                  notice={unverified.notice}
                  submitLabel="Verify and sign in"
                  repeatedInvalidCodeHint="If new codes keep being rejected, wait a few hours and try again, or go back and reset your password, which also confirms your email."
                  onSubmit={async (code) => {
                    const result = await emailCodes.verifyEmail(unverified.email, code);
                    if (result.error) return emailCodeErrorMessage(result.error);
                    await handleLogin(unverified);
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
                      variant="outline"
                      onPress={handleGoogleSignIn}
                      loading={googleLoading}
                      disabled={isSubmitting || googleLoading}
                    >
                      <Text>Continue with Google</Text>
                    </Button>
                    <View className="flex-row items-center gap-4">
                      <View className="flex-1 h-px bg-border" />
                      <Text className="text-sm uppercase tracking-[0.18em] text-muted">or</Text>
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
                  textContentType="emailAddress"
                  returnKeyType="next"
                />
                <Input
                  control={form.control}
                  name="password"
                  label="Password"
                  placeholder="Password"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="password"
                  textContentType="password"
                  returnKeyType="done"
                  onSubmitEditing={isSubmitting ? undefined : form.handleSubmit(handleLogin)}
                />
                {providers?.email ? (
                  <Link
                    href={{
                      pathname: "/forgotPassword",
                      params: { joinCode, email: enteredEmail },
                    }}
                    asChild
                  >
                    <Pressable className="self-end py-1" accessibilityRole="link">
                      <Text className="font-semibold text-primary-text">Forgot password?</Text>
                    </Pressable>
                  </Link>
                ) : null}
                <Button onPress={form.handleSubmit(handleLogin)} disabled={isSubmitting}>
                  <Text>{emailLoading ? "Signing in…" : "Sign In"}</Text>
                </Button>
              </View>
            )}
            <View className="items-center gap-4 pt-2">
              <Link href={{ pathname: "/signUp", params: { joinCode } }} asChild>
                <Pressable accessibilityRole="link">
                  <Text className="text-muted">
                    Don't have an account?{" "}
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
