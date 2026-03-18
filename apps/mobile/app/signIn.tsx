import { zodResolver } from "@hookform/resolvers/zod";
import { signInSchema } from "@openbeacon/schemas";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { z } from "zod";
import { ReturnToHomeHeader } from "../components/headers/ReturnToHomeHeader.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Input } from "../components/ui/Input.tsx";
import { Text } from "../components/ui/Text.tsx";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "../lib/auth-client.ts";
import { tryCatch } from "../lib/tryCatch.ts";

export default function SignIn() {
  const [loading, setLoading] = useState(false);

  const form = useForm<z.infer<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    mode: "onTouched",
    defaultValues: {
      email: "",
      password: "",
    },
    shouldFocusError: true,
  });

  const handleLogin = async () => {
    setLoading(true);
    const { email, password } = form.getValues();

    const result = await authClient.signIn.email({ email: email, password });
    if (result.error) {
      Alert.alert("Sign in failed", result.error.message);
      setLoading(false);
      return;
    }

    const { data: tokenToRevoke } = await tryCatch(
      SecureStore.getItemAsync(SESSION_TOKEN_TO_REVOKE_KEY),
    );
    if (tokenToRevoke) {
      const revokeResult = await authClient.revokeSession({ token: tokenToRevoke });
      if (revokeResult.error) {
        setLoading(false);
        return;
      }
      await SecureStore.deleteItemAsync(SESSION_TOKEN_TO_REVOKE_KEY);
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
            <Text className="font-bold text-5xl">Welcome{"\n"}back.</Text>
            <Text className="text-lg text-muted">Sign in to your account</Text>
          </View>
          <View className="gap-5">
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
              onSubmitEditing={form.handleSubmit(handleLogin)}
            />
            <Button onPress={form.handleSubmit(handleLogin)} disabled={loading}>
              <Text>{loading ? "Signing in…" : "Sign In"}</Text>
            </Button>
          </View>
          <View className="items-center gap-4 pt-2">
            <Pressable onPress={() => router.push("/signUp")} accessibilityRole="link">
              <Text className="text-muted">
                Don't have an account?{" "}
                <Text className="font-semibold text-primary">Create one</Text>
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
