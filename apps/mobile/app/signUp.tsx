import { router } from "expo-router";
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
import { FormInput } from "../components/FormInput.tsx";
import { ReturnToHomeHeader } from "../components/headers/ReturnToHomeHeader.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Text } from "../components/ui/Text.tsx";
import { authClient } from "../lib/auth-client.ts";
import { tryCatch } from "../lib/tryCatch.ts";

export default function SignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const handleSignUp = async () => {
    if (!name.trim() || !email.trim() || !password) return;
    setLoading(true);

    const { error: signUpError, data: signUpResponse } = await tryCatch(
      authClient.signUp.email({
        email: email.trim(),
        password,
        name: name.trim(),
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

          <View className="gap-5">
            <FormInput
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
            />
            <FormInput
              ref={emailRef}
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
              onSubmitEditing={handleSignUp}
            />
            <Button onPress={handleSignUp} disabled={loading}>
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
