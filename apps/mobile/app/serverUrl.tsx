import { router } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button.tsx";
import { FormInput } from "../components/FormInput.tsx";
import { ReturnToHomeHeader } from "../components/headers/ReturnToHomeHeader.tsx";
import { Text } from "../components/Text.tsx";
import { getServerUrl, hasCustomServerUrl, setServerUrl } from "../lib/server-url.ts";

export default function ServerUrl() {
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
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.select({ ios: "padding", android: undefined })}>
        <ScrollView
          contentContainerClassName="px-8 pt-4 pb-10 gap-10"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ReturnToHomeHeader />

          <View className="gap-5">
            <Text className="font-bold text-5xl">Custom{"\n"}server</Text>
            <Text className="text-lg text-muted">
              Point OpenBeacon at your own self-hosted backend. Leave blank to use the default
              hosted server.
            </Text>
          </View>

          <View className="gap-5">
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

            <View className="bg-primary/10 rounded-lg p-4 border border-primary/15">
              <Text className="text-sm text-muted">
                Changes take effect after restarting the app. Your current session will remain
                active.
              </Text>
            </View>

            <Button title="Save" onPress={handleSave} />
            {hasCustomServerUrl() && (
              <Button title="Use Default Server" variant="secondary" onPress={handleClear} />
            )}
          </View>

          <View className="h-px bg-border" />

          <View className="gap-2">
            <Text className="font-semibold text-lg">Self-hosting OpenBeacon</Text>
            <Text className="text-muted">
              OpenBeacon is fully open source. You can run your own backend using Docker — see the
              project README for setup instructions.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
