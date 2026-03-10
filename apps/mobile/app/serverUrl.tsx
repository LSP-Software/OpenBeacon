import { router } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button.tsx";
import { FormInput } from "../components/FormInput.tsx";
import { getServerUrl, hasCustomServerUrl, setServerUrl } from "../lib/server-url.ts";
import { useColors } from "../lib/theme.ts";

export default function ServerUrl() {
  const colors = useColors();
  const [url, setUrl] = useState(() => getServerUrl());

  const handleSave = () => {
    const trimmed = url.trim();
    if (trimmed) {
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          Alert.alert("Invalid URL", "Server URL must start with http:// or https://");
          return;
        }
      } catch {
        Alert.alert("Invalid URL", "Server URL must start with http:// or https://");
        return;
      }
    }
    setServerUrl(trimmed);
    Alert.alert(
      trimmed ? "Server saved" : "Using default server",
      trimmed
        ? "Restart the app to connect to your custom server."
        : "Restart the app to switch back to the default server.",
      [{ text: "OK", onPress: () => router.back() }],
    );
  };

  const handleClear = () => {
    setUrl("");
    setServerUrl("");
    Alert.alert("Using default server", "Restart the app to switch back to the default server.", [
      { text: "OK", onPress: () => router.back() },
    ]);
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
            <Text style={[styles.title, { color: colors.text }]}>Custom{"\n"}server.</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Point OpenBeacon at your own self-hosted backend. Leave blank to use the default
              hosted server.
            </Text>
          </View>

          <View style={styles.form}>
            <FormInput
              label="Server URL"
              value={url}
              onChangeText={setUrl}
              placeholder="https://your-server.example.com"
              keyboardType="default"
              autoCapitalize="none"
              autoComplete="off"
              textContentType="URL"
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />

            <View
              style={[
                styles.infoBox,
                { backgroundColor: colors.primaryDim, borderColor: colors.inputBorder },
              ]}
            >
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                Changes take effect after restarting the app. Your current session will remain
                active.
              </Text>
            </View>

            <Button title="Save" onPress={handleSave} />
            {hasCustomServerUrl() && (
              <Button title="Use Default Server" variant="secondary" onPress={handleClear} />
            )}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.docsSection}>
            <Text style={[styles.docsTitle, { color: colors.text }]}>Self-hosting OpenBeacon</Text>
            <Text style={[styles.docsText, { color: colors.textSecondary }]}>
              OpenBeacon is fully open source. You can run your own backend using Docker — see the
              project README for setup instructions.
            </Text>
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
    paddingBottom: 48,
    gap: 32,
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
    fontSize: 15,
    lineHeight: 23,
  },
  form: {
    gap: 16,
  },
  infoBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  infoText: {
    fontSize: 13,
    lineHeight: 19,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  docsSection: {
    gap: 10,
  },
  docsTitle: {
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  docsText: {
    fontSize: 14,
    lineHeight: 22,
  },
});
