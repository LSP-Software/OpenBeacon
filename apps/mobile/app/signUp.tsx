import { zodResolver } from "@hookform/resolvers/zod";
import { signUpSchema } from "@openbeacon/schemas";
import { router } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { z } from "zod";
import { ReturnToHomeHeader } from "../components/headers/ReturnToHomeHeader.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Input } from "../components/ui/Input.tsx";
import { Text } from "../components/ui/Text.tsx";
import { authClient } from "../lib/auth-client.ts";
import { tryCatch } from "../lib/tryCatch.ts";

export default function SignUp() {
  const [loading, setLoading] = useState(false);
  const form = useForm<z.infer<typeof signUpSchema>>({
    resolver: zodResolver(signUpSchema),
    mode: "onTouched",
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
    shouldFocusError: true,
  });

  const handleSignUp = async () => {
    const { name, email, password } = form.getValues();
    setLoading(true);

    const { error: signUpError, data: signUpResponse } = await tryCatch(
      authClient.signUp.email({
        email,
        password,
        name,
      }),
    );
    if (signUpError || signUpResponse?.error) {
      Alert.alert(
        "Sign up failed",
        signUpResponse?.error?.message ?? signUpError?.message ?? "An error occurred",
      );
      setLoading(false);
      return;
    }

    router.replace("/");
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <ScrollView
          contentContainerClassName="px-8 pt-4 pb-10 gap-10"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ReturnToHomeHeader />

          <View className="gap-5">
            <Text className="font-bold text-5xl">Create{"\n"}account.</Text>
            <Text className="text-lg text-muted">Join OpenBeacon today</Text>
          </View>

          <View className="gap-4">
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
              onSubmitEditing={form.handleSubmit(handleSignUp)}
            />
            <Button onPress={form.handleSubmit(handleSignUp)} disabled={loading}>
              <Text>{loading ? "Creating account…" : "Create Account"}</Text>
            </Button>
          </View>

          <View className="items-center gap-4 pt-2">
            <Pressable onPress={() => router.push("/signIn")} accessibilityRole="link">
              <Text className="text-muted">
                Already have an account? <Text className="font-semibold text-primary">Sign in</Text>
              </Text>
            </Pressable>
            <Pressable
              className="py-1"
              onPress={() => router.push("/serverUrl")}
              accessibilityRole="button"
            >
              <Text className="text-secondary">Using a self-hosted server?</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
