import { Alert } from "../lib/alert.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Link, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { z } from "zod";
import { KeyboardFormScrollView } from "../components/KeyboardFormScrollView.tsx";
import { ReturnToHomeHeader } from "../components/headers/ReturnToHomeHeader.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Input } from "../components/ui/Input.tsx";
import { Text } from "../components/ui/Text.tsx";
import { trpc } from "../lib/api.ts";
import { completeAuthenticatedSessionSetup, isNativeGoogleSignInConfigured } from "../lib/auth.ts";
import { authClient } from "../lib/auth-client.ts";
import { finishAuthentication } from "../lib/finishAuthentication.ts";
import { performGoogleAuth } from "../lib/googleAuth.ts";
import { signUpFormSchema } from "../lib/signUpSchema.ts";

const SignUp = () => {
  const { joinCode } = useLocalSearchParams<{ joinCode?: string }>();
  const finishSignUp = () => finishAuthentication({ joinCode });
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const { data: providers } = useQuery(trpc.auth.providers.queryOptions());
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

  const handleSignUp = async ({ name, email, password }: z.infer<typeof signUpFormSchema>) => {
    setEmailLoading(true);

    const result = await authClient.signUp.email({
      email,
      password,
      name,
    });

    if (result.error) {
      Alert.alert("Sign up failed", result.error.message);
      setEmailLoading(false);
      return;
    }

    const sessionSetupResult = await completeAuthenticatedSessionSetup();
    if (sessionSetupResult.error) {
      Alert.alert("Unable to finish account setup", sessionSetupResult.error.message);
      setEmailLoading(false);
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

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardFormScrollView contentContainerClassName="px-8 pt-2 pb-6 gap-6">
        {(formProps) => (
          <>
            <ReturnToHomeHeader />

            <View className="gap-2">
              <Text className="font-bold text-5xl">Create{"\n"}account.</Text>
              <Text className="text-lg text-muted">Join OpenBeacon today</Text>
            </View>

            <View className="gap-4" {...formProps}>
              {isGoogleEnabled ? (
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
              ) : null}
              <Input
                control={form.control}
                name="name"
                label="Name"
                placeholder="Your name"
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
              />
              <Input
                control={form.control}
                name="email"
                label="Email"
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
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
                onSubmitEditing={form.handleSubmit(handleSignUp)}
              />
              <Button onPress={form.handleSubmit(handleSignUp)} disabled={isSubmitting}>
                <Text>{emailLoading ? "Creating account…" : "Create Account"}</Text>
              </Button>
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
