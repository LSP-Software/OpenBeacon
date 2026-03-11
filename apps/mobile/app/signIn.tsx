import { router } from "expo-router";
import { useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button.tsx";
import { FormInput } from "../components/FormInput.tsx";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "../lib/auth-client.ts";
import { storage } from "../lib/storage.ts";
import { useColors } from "../lib/theme.ts";

export default function SignIn() {
  const colors = useColors();

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
      const tokenToRevoke = storage.getString(SESSION_TOKEN_TO_REVOKE_KEY);
      if (tokenToRevoke) {
        void authClient.revokeSession({ token: tokenToRevoke }).finally(() => {
          storage.remove(SESSION_TOKEN_TO_REVOKE_KEY);
        });
      }
      router.replace("/");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={[styles.backText, { color: colors.primary }]}>← Back</Text>
          </Pressable>

          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Welcome{"\n"}back.</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Sign in to your account
            </Text>
          </View>

          <View style={styles.form}>
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

          <View style={styles.footer}>
            <Pressable onPress={() => router.push("/signUp")} accessibilityRole="link">
              <Text style={[styles.footerText, { color: colors.textSecondary }]}>
                Don't have an account?{" "}
                <Text style={[styles.footerLink, { color: colors.primary }]}>Create one</Text>
              </Text>
            </Pressable>
            <Pressable
              style={styles.serverLinkPressable}
              onPress={() => router.push("/serverUrl")}
              accessibilityRole="button"
            >
              <Text style={[styles.serverLinkText, { color: colors.textMuted }]}>
                Using a self-hosted server?
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 32,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 36,
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  backText: {
    fontSize: 16,
    fontWeight: "500",
  },
  header: {
    gap: 12,
  },
  title: {
    fontSize: 44,
    fontWeight: "800",
    letterSpacing: -1.5,
    lineHeight: 50,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "400",
  },
  form: {
    gap: 20,
  },
  footer: {
    alignItems: "center",
    gap: 16,
    paddingTop: 8,
  },
  footerText: {
    fontSize: 15,
  },
  footerLink: {
    fontWeight: "600",
  },
  serverLinkPressable: {
    paddingVertical: 4,
  },
  serverLinkText: {
    fontSize: 13,
  },
});
