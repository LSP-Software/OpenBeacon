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
import { HeldKeysNotice } from "../components/HeldKeysNotice.tsx";
import { ReturnToHomeHeader } from "../components/headers/ReturnToHomeHeader.tsx";
import { ServerNotice } from "../components/ServerNotice.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Input } from "../components/ui/Input.tsx";
import { Text } from "../components/ui/Text.tsx";
import { trpc } from "../lib/api.ts";
import { completeAuthenticatedSessionSetup, useCanOfferGoogleSignIn } from "../lib/auth.ts";
import { authClient } from "../lib/auth-client.ts";
import { emailCodeErrorMessage, emailCodes } from "../lib/emailCodes.ts";
import { finishAuthentication } from "../lib/finishAuthentication.ts";
import { performGoogleAuth } from "../lib/googleAuth.ts";
import { signUpFormSchema } from "../lib/signUpSchema.ts";
import { screenTitleClass } from "../components/onboarding/screenTitleClass.ts";

const SignUp = () => {
  const { joinCode } = useLocalSearchParams<{ joinCode?: string }>();
  const finishSignUp = () => finishAuthentication({ joinCode, newAccount: true });
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const {
    data: providers,
    isFetching: providersFetching,
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
  const isGoogleEnabled = useCanOfferGoogleSignIn(providers);
  const verifiesEmail = providers?.email === true;
  const signUpToken = step.name === "details" ? step.signUpToken : undefined;

  const handleEmailContinue = async () => {
    if (!(await form.trigger("email"))) return;
    const email = signUpFormSchema.shape.email.parse(form.getValues("email"));
    setEmailLoading(true);
    const result = await emailCodes.requestSignUpCode(email);
    setEmailLoading(false);
    if (result.error && result.error.status !== 429) {
      Alert.alert("Couldn’t send a code", emailCodeErrorMessage(result.error));
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
        Alert.alert("Couldn’t create your account", result.error.message);
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
    if (sessionSetupResult?.deviceRemoved) {
      setEmailLoading(false);
      return;
    }
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
      failureTitle: "Couldn’t sign up with Google",
      onSuccess: finishSignUp,
      alert: Alert.alert,
    });
  };

  if (providersPending) return <LoadingIndicator />;
  if (!providers) {
    return (
      <SafeAreaView className="flex-1 bg-background px-6 pt-1">
        <ReturnToHomeHeader />
        <View className="flex-1 items-center justify-center gap-4">
          <Text className="text-center text-foreground">
            Couldn’t load sign-up options. Check your connection and try again.
          </Text>
          <Button
            variant="secondary"
            loading={providersFetching}
            onPress={() => void refetchProviders()}
          >
            <Text>Try again</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const googleSignUp = isGoogleEnabled ? (
    <>
      <Button
        variant="secondary"
        onPress={handleGoogleSignUp}
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
      textContentType="username"
      {...(verifiesEmail
        ? { returnKeyType: "done", onSubmitEditing: isSubmitting ? undefined : handleEmailContinue }
        : {})}
    />
  );

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardFormScrollView contentContainerClassName="gap-6 px-6 pb-6 pt-1">
        {(formProps) => (
          <>
            <ReturnToHomeHeader />
            <HeldKeysNotice />

            <View className="gap-2">
              <Text accessibilityRole="header" className={screenTitleClass}>
                {step.name === "code" ? "Check your email" : "Create your account"}
              </Text>
              <Text className="text-secondary text-base">
                {step.name === "code"
                  ? "Enter the code we emailed you"
                  : step.name === "details"
                    ? "Choose your name and password"
                    : "Join OpenBeacon today"}
              </Text>
            </View>

            <ServerNotice />
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
                    <Text className="text-secondary">
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
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                  />
                  <Input
                    control={form.control}
                    name="confirmPassword"
                    label="Confirm password"
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    returnKeyType="done"
                    onSubmitEditing={isSubmitting ? undefined : form.handleSubmit(handleSignUp)}
                  />
                  <Button onPress={form.handleSubmit(handleSignUp)} disabled={isSubmitting}>
                    <Text>{emailLoading ? "Creating account…" : "Create account"}</Text>
                  </Button>
                </>
              )}
            </View>

            <View className="items-center gap-4 pt-2">
              <Link href={{ pathname: "/signIn", params: { joinCode } }} replace asChild>
                <Pressable accessibilityRole="link">
                  <Text className="text-secondary">
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
