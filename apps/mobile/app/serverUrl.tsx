import { Alert } from "../lib/alert.ts";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, router } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import z from "zod";
import { ReturnToHomeHeader } from "../components/headers/ReturnToHomeHeader.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Input } from "../components/ui/Input.tsx";
import { Separator } from "../components/ui/Separator.tsx";
import { Text } from "../components/ui/Text.tsx";
import { useServerChange } from "../hooks/useServerChange.ts";
import { changeServer } from "../lib/changeServer.ts";
import { getServerUrl, hasCustomServerUrl, normaliseServerUrl } from "../lib/currentServer.ts";
import { thisDeviceNoun } from "../lib/thisDeviceNoun.ts";

const serverUrlSchema = z.object({
  url: z.string().superRefine((url, context) => {
    const { error } = normaliseServerUrl(url);
    if (error) context.addIssue({ code: "custom", message: error });
  }),
});

export default function ServerUrl() {
  const [clearing, setClearing] = useState(false);
  const { signedIn, warnBeforeChange, checkCompatibilityBeforeSave } = useServerChange();
  const form = useForm<z.infer<typeof serverUrlSchema>>({
    resolver: zodResolver(serverUrlSchema),
    mode: "onTouched",
    defaultValues: {
      url: getServerUrl(),
    },
    shouldFocusError: true,
  });

  const handleSave = async (data: z.infer<typeof serverUrlSchema>) => {
    const { url } = normaliseServerUrl(data.url);
    if (!url) return;
    await warnBeforeChange(url, () =>
      checkCompatibilityBeforeSave(url, async () => {
        await changeServer(url);
        Alert.alert("Server saved", undefined, [{ text: "OK", onPress: () => router.back() }]);
      }),
    );
  };

  const handleClear = () =>
    warnBeforeChange("", async () => {
      setClearing(true);
      await changeServer("");
      setClearing(false);
      Alert.alert("Using default server", undefined, [
        { text: "OK", onPress: () => router.back() },
      ]);
    });

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <ScrollView
          contentContainerClassName="gap-8 px-6 pb-10 pt-1"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ReturnToHomeHeader />

          <View className="gap-5">
            <Text accessibilityRole="header" className="text-3xl font-bold">
              Custom server
            </Text>
            <Text className="text-secondary text-base">
              Point OpenBeacon at your own self-hosted backend, for example
              https://beacon.example.com. It must use https:// with a valid certificate.
            </Text>
          </View>

          <View className="gap-5">
            <Input
              control={form.control}
              name="url"
              label="Server URL"
              placeholder="https://your-server.example.com"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="off"
              textContentType="URL"
              returnKeyType="done"
              onSubmitEditing={() => {
                if (!form.formState.isSubmitting) void form.handleSubmit(handleSave)();
              }}
            />

            <View className="rounded-xl bg-secondary p-4">
              <Text className="text-sm text-secondary">
                Changing server signs you out on this {thisDeviceNoun()}.
                {signedIn
                  ? " Your keys stay on it for 30 days, unless you sign in to a different account."
                  : ""}
              </Text>
            </View>

            <Button
              onPress={form.handleSubmit(handleSave)}
              disabled={!form.formState.isDirty}
              loading={form.formState.isSubmitting}
            >
              <Text>Save</Text>
            </Button>
            {hasCustomServerUrl() && (
              <Button variant="secondary" loading={clearing} onPress={handleClear}>
                <Text>Use default server</Text>
              </Button>
            )}
          </View>

          <Separator />

          <View className="gap-2">
            <Text className="font-semibold text-lg">Self-hosting OpenBeacon</Text>
            <Text className="text-secondary">
              OpenBeacon is fully open source. You can run your own backend using Docker behind
              HTTPS.
            </Text>
            <View className="flex-row flex-wrap gap-x-6 gap-y-2 pt-1">
              <Link
                href="https://docs.openbeacon.net/docs/self-host/self-hosting-overview"
                className="text-primary-text"
              >
                Self-hosting guide
              </Link>
              <Link href="https://github.com/LSP-Software/OpenBeacon" className="text-primary-text">
                Source code on GitHub
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
