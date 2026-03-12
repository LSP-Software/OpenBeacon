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
import { Button } from "../components/Button.tsx";
import { FormInput } from "../components/FormInput.tsx";
import { ReturnToHomeHeader } from "../components/headers/ReturnToHomeHeader.tsx";
import { Text } from "../components/Text.tsx";
import { authClient } from "../lib/auth-client.ts";
import { tryCatch } from "../lib/trycatch.ts";

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

    const {error: signUpError} = await tryCatch(authClient.signUp.email({
      email: email.trim(),
      password,
      name: name.trim(),
    }));
    if (signUpError) {
      Alert.alert("Sign up failed", signUpError.message ?? "An error occurred");
      return;
    }
    router.replace("/");
    setLoading(false);

  };

  return (
    <SafeAreaView>
      <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })}>
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
            <Button
              title={loading ? "Creating account…" : "Create Account"}
              onPress={handleSignUp}
              disabled={loading}
            />
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
