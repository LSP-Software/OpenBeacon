import { tryCatch } from "@openbeacon/shared";
import { CheckIcon } from "lucide-react-native";
import { useState } from "react";
import { Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpcClient } from "../../lib/api.ts";

const ContactUsScreen = () => {
  const [message, setMessage] = useState("");
  const [includeEmail, setIncludeEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<"success" | "error" | null>(null);

  const submit = async () => {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    setStatus(null);
    const result = await tryCatch(
      trpcClient.account.submitFeedback.mutate({
        message,
        includeEmail,
        androidVersion: Platform.OS === "android" ? Platform.constants.Release : undefined,
      }),
    );
    setSubmitting(false);
    if (result.error) {
      setStatus("error");
      return;
    }
    setMessage("");
    setIncludeEmail(false);
    setStatus("success");
  };

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          <BackButton />
          <Text className="text-foreground text-2xl font-bold">Contact Us</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>
      <ScrollView contentContainerClassName="gap-5 px-6 py-6">
        <Text className="text-muted-foreground">
          Your feedback is stored on your configured server and can be read by its administrators.
          Please do not include personal information unless you want to share it.
          {Platform.OS === "android" && " Your Android version is included with your feedback."}
        </Text>
        <TextInput
          accessibilityLabel="Feedback"
          multiline
          maxLength={5000}
          value={message}
          onChangeText={setMessage}
          placeholder="How can we help?"
          textAlignVertical="top"
          className="min-h-40 rounded-lg border border-border bg-input p-4 text-foreground"
        />
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: includeEmail }}
          onPress={() => setIncludeEmail(!includeEmail)}
          className="flex-row items-center gap-3"
        >
          <View className="size-6 items-center justify-center rounded border border-border">
            {includeEmail && <Icon as={CheckIcon} className="size-4 text-foreground" />}
          </View>
          <Text className="flex-1">Include my account email for follow-up</Text>
        </Pressable>
        <Button onPress={submit} disabled={!message.trim() || submitting}>
          <Text>{submitting ? "Sending…" : "Send feedback"}</Text>
        </Button>
        {status === "success" && <Text>Feedback sent. Thank you.</Text>}
        {status === "error" && <Text>Could not send feedback. Please try again.</Text>}
      </ScrollView>
    </View>
  );
};

export default ContactUsScreen;
