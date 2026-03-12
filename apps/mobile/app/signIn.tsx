import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  type TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button.tsx";
import { FormInput } from "../components/FormInput.tsx";
import { ReturnToHomeHeader } from "../components/headers/ReturnToHomeHeader.tsx";
import { Text } from "../components/Text.tsx";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "../lib/auth-client.ts";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordRef = useRef<TextInput>(null);

  const handleLogin = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    try {
      const response = await authClient.signIn.email({ email: email.trim(), password });
      if (response.error) {
        Alert.alert("Sign in failed", response.error.message ?? "An error occurred");
        return;
      }
      const tokenToRevoke = await SecureStore.getItemAsync(SESSION_TOKEN_TO_REVOKE_KEY);
      if (tokenToRevoke) {
        void authClient.revokeSession({ token: tokenToRevoke }).then(async (result) => {
          if (!result?.error) {
            await SecureStore.deleteItemAsync(SESSION_TOKEN_TO_REVOKE_KEY);
          }
        });
      }
      router.replace("/");
    } finally {
      setLoading(false);
    }
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
            <FormInput
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <FormInput
              ref={passwordRef}
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
            <Button
              title={loading ? "Signing in…" : "Sign In"}
              onPress={handleLogin}
              disabled={loading}
            />
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
