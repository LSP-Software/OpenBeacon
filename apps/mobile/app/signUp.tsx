import { Alert } from "../lib/alert.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Link, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { z } from "zod";
import { EmailCodeEntry } from "../components/EmailCodeEntry.tsx";
import { KeyboardFormScrollView } from "../components/KeyboardFormScrollView.tsx";
import { LoadingIndicator } from "../components/LoadingIndicator.tsx";
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
import { signUpFormSchema } from "../lib/signUpSchema.ts";

const SignUp = () => {
  const { joinCode } = useLocalSearchParams<{ joinCode?: string }>();
  const finishSignUp = () => finishAuthentication({ joinCode, newAccount: true });
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const {
    data: providers,
    isPending: providersPending,
    refetch: refetchProviders,
  } = useQuery(trpc.auth.providers.queryOptions());
  const [step, setStep] = useState<
    | { name: "email" }
    | { name: "code"; email: string; notice: string | undefined }
    | { name: "details"; email: string; signUpToken: string }
  >({ name: "email" });
  const form = useForm<z.infer<typeof signUpFormSchema>>({
    resolver: zodResolver(signUpFormSchema),
    mode: "onTouched",
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
    shouldFocusError: true,
  });

  const isSubmitting = emailLoading || googleLoading;
  const isGoogleEnabled = providers?.google === true && isNativeGoogleSignInConfigured;
  const verifiesEmail = providers?.email === true;
  const signUpToken = step.name === "details" ? step.signUpToken : undefined;

  const handleEmailContinue = async () => {
    if (!(await form.trigger("email"))) return;
    const email = signUpFormSchema.shape.email.parse(form.getValues("email"));
    setEmailLoading(true);
    const result = await emailCodes.requestSignUpCode(email);
    setEmailLoading(false);
    if (result.error && result.error.status !== 429) {
      Alert.alert("Couldn't send a code", emailCodeErrorMessage(result.error));
      return;
    }
    setStep({
      name: "code",
      email,
      notice: result.error ? emailCodeErrorMessage(result.error) : undefined,
    });
  };

  const handleSignUp = async ({ name, email, password }: z.infer<typeof signUpFormSchema>) => {
    setEmailLoading(true);

    const result = await authClient.signUp.email({
      email,
      password,
      name,
      ...(signUpToken ? { signUpToken } : {}),
    });

    if (result.error) {
      if (result.error.code === "INVALID_SIGN_UP_TOKEN") {
        await refetchProviders();
        Alert.alert(
          "Verify your email again",
          "Your email verification has expired. Enter your email to get a new code.",
        );
        setStep({ name: "email" });
      } else {
        Alert.alert("Sign up failed", result.error.message);
      }
      setEmailLoading(false);
      return;
    }

    const signInResult = result.data.token
      ? null
      : await authClient.signIn.email({ email, password });
    const sessionSetupResult = signInResult?.error
      ? null
      : await completeAuthenticatedSessionSetup();
    if (signInResult?.error || sessionSetupResult?.error) {
      setEmailLoading(false);
      Alert.alert("Account created", "Your account has been created. Sign in to continue.");
      router.replace({ pathname: "/signIn", params: { joinCode, email } });
      return;
    }

    await finishSignUp();
  };

  const handleGoogleSignUp = async () => {
    await performGoogleAuth({
      setLoading: setGoogleLoading,
      failureTitle: "Google sign up failed",
      onSuccess: finishSignUp,
      alert: Alert.alert,
    });
  };

  if (providersPending) return <LoadingIndicator />;

  const googleSignUp = isGoogleEnabled ? (
    <>
      <Button
        variant="outline"
        onPress={handleGoogleSignUp}
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
  ) : null;

  const emailInput = (
    <Input
      control={form.control}
      name="email"
      label="Email"
      placeholder="you@example.com"
      keyboardType="email-address"
      autoCapitalize="none"
      autoComplete="email"
      textContentType="emailAddress"
      {...(verifiesEmail
        ? { returnKeyType: "done", onSubmitEditing: isSubmitting ? undefined : handleEmailContinue }
        : {})}
    />
  );

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardFormScrollView contentContainerClassName="px-8 pt-2 pb-6 gap-6">
        {(formProps) => (
          <>
            <ReturnToHomeHeader />

            <View className="gap-2">
              <Text className="font-bold text-5xl">
                {step.name === "code" ? "Check your\nemail." : "Create\naccount."}
              </Text>
              <Text className="text-lg text-muted">
                {step.name === "code"
                  ? "Enter the code we emailed you"
                  : step.name === "details"
                    ? "Choose your name and password"
                    : "Join OpenBeacon today"}
              </Text>
            </View>

            <View className="gap-4" {...formProps}>
              {verifiesEmail && step.name === "code" ? (
                <>
                  <EmailCodeEntry
                    email={step.email}
                    notice={step.notice}
                    submitLabel="Continue"
                    onSubmit={async (code) => {
                      const result = await emailCodes.verifySignUpCode(step.email, code);
                      if (result.error) return emailCodeErrorMessage(result.error);
                      setStep({
                        name: "details",
                        email: step.email,
                        signUpToken: result.data.signUpToken,
                      });
                      return undefined;
                    }}
                    onResend={async () => {
                      const result = await emailCodes.requestSignUpCode(step.email);
                      return result.error ? emailCodeErrorMessage(result.error) : undefined;
                    }}
                  />
                  <Pressable
                    className="items-center py-1"
                    onPress={() => setStep({ name: "email" })}
                    accessibilityRole="button"
                  >
                    <Text className="text-secondary">Use a different email</Text>
                  </Pressable>
                </>
              ) : verifiesEmail && step.name === "email" ? (
                <>
                  {googleSignUp}
                  {emailInput}
                  <Button onPress={handleEmailContinue} disabled={isSubmitting}>
                    <Text>{emailLoading ? "Sending code…" : "Continue"}</Text>
                  </Button>
                </>
              ) : (
                <>
                  {step.name === "details" ? (
                    <Text className="text-muted">
                      Creating an account for <Text className="font-semibold">{step.email}</Text>
                    </Text>
                  ) : (
                    googleSignUp
                  )}
                  <Input
                    control={form.control}
                    name="name"
                    label="Name"
                    placeholder="Your name"
                    autoCapitalize="words"
                    autoComplete="name"
                    textContentType="name"
                  />
                  {step.name === "details" ? null : emailInput}
                  <Input
                    control={form.control}
                    name="password"
                    label="Password"
                    placeholder="Password"
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="password"
                    textContentType="password"
                  />
                  <Input
                    control={form.control}
                    name="confirmPassword"
                    label="Confirm password"
                    placeholder="Confirm password"
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    returnKeyType="done"
                    onSubmitEditing={isSubmitting ? undefined : form.handleSubmit(handleSignUp)}
                  />
                  <Button onPress={form.handleSubmit(handleSignUp)} disabled={isSubmitting}>
                    <Text>{emailLoading ? "Creating account…" : "Create Account"}</Text>
                  </Button>
                </>
              )}
            </View>

            <View className="items-center gap-4 pt-2">
              <Link href={{ pathname: "/signIn", params: { joinCode } }} asChild>
                <Pressable accessibilityRole="link">
                  <Text className="text-muted">
                    Already have an account?{" "}
                    <Text className="font-semibold text-primary-text">Sign in</Text>
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

export default SignUp;
