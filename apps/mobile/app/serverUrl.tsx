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
import { checkServerCompatibility } from "../lib/apiCompatibility.ts";
import { changeServer } from "../lib/changeServer.ts";
import { getServerUrl, hasCustomServerUrl, normaliseServerUrl } from "../lib/currentServer.ts";

const serverUrlSchema = z.object({
  url: z.string().superRefine((url, context) => {
    const { error } = normaliseServerUrl(url);
    if (error) context.addIssue({ code: "custom", message: error });
  }),
});

export default function ServerUrl() {
  const [clearing, setClearing] = useState(false);
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

    const save = async () => {
      await changeServer(url);
      Alert.alert("Server saved", "Restart the app to connect to your custom server.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    };

    const { verdict, serverVersion } = await checkServerCompatibility(url);
    if (verdict === "ok") {
      await save();
      return;
    }
    Alert.alert(
      verdict === null
        ? "Couldn't reach this server"
        : verdict === "appTooOld"
          ? "Update the app first"
          : "This server needs updating",
      verdict === null
        ? "Check the address, that the server is running and that it has a valid HTTPS certificate."
        : verdict === "appTooOld"
          ? "This server needs a newer version of Open Beacon. Update the app before using it."
          : `This server is running version ${serverVersion}, which is too old for this app. Ask whoever runs it to update it. You won't be able to share your location until it's updated.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Save anyway", onPress: () => void save() },
      ],
    );
  };

  const handleClear = async () => {
    setClearing(true);
    await changeServer("");
    setClearing(false);
    Alert.alert("Using default server", "Restart the app to switch back to the default server.", [
      { text: "OK", onPress: () => router.back() },
    ]);
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
            <Text className="font-bold text-5xl">Custom{"\n"}server</Text>
            <Text className="text-lg text-muted">
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

            <View className="bg-primary/10 rounded-lg p-4 border border-primary/15">
              <Text className="text-sm text-muted">
                Changing server signs you out on this phone. Changes take effect after restarting
                the app.
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
              <Button variant="outline" loading={clearing} onPress={handleClear}>
                <Text>Use Default Server</Text>
              </Button>
            )}
          </View>

          <Separator />

          <View className="gap-2">
            <Text className="font-semibold text-lg">Self-hosting OpenBeacon</Text>
            <Text className="text-muted">
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
