import { FEEDBACK_MESSAGE_MAX_LENGTH } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { CheckIcon } from "lucide-react-native";
import { useState } from "react";
import { Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useMapVersion } from "../../hooks/useMapVersion.ts";
import { appVersion, maplibreVersion } from "../../lib/versions.ts";
import { feedbackClient, trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { hasCustomServerUrl } from "../../lib/currentServer.ts";

const ContactUsScreen = () => {
  const [message, setMessage] = useState("");
  const [includeEmail, setIncludeEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<"success" | "error" | "rateLimited" | null>(null);
  const { data: session } = authClient.useSession();
  const serverVersion = useQuery(trpc.account.version.queryOptions());
  const mapVersion = useMapVersion();
  const selfHosted = hasCustomServerUrl();
  const canSubmit = message.trim() !== "" && !submitting && (!includeEmail || !!session);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setStatus(null);
    const result = await tryCatch(
      feedbackClient.feedback.submit.mutate({
        message,
        email: includeEmail ? session?.user.email : undefined,
        appVersion,
        maplibreVersion,
        mapVersion: mapVersion?.summary,
        serverVersion: serverVersion.data,
        androidVersion: Platform.OS === "android" ? Platform.constants.Release : undefined,
      }),
    );
    setSubmitting(false);
    if (result.error) {
      setStatus(
        result.error instanceof TRPCClientError && result.error.data?.code === "TOO_MANY_REQUESTS"
          ? "rateLimited"
          : "error",
      );
      return;
    }
    setMessage("");
    setIncludeEmail(false);
    setStatus("success");
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Contact Us" />
      <ScrollView
        contentContainerClassName="gap-5 px-6 py-6"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        <Text className="font-semibold text-foreground">
          Your feedback is sent directly to the developers of OpenBeacon
          {selfHosted ? ", rather than to the operator of your self-hosted server." : "."}
        </Text>
        <Text className="text-tertiary">
          Feedback is not linked to your account. Please do not include personal information unless
          you want to share it. Your app, MapLibre React Native, server
          {Platform.OS === "android" ? ", and Android" : ""} versions are included with your
          feedback.
        </Text>
        {selfHosted && (
          <Text className="text-tertiary">
            Deleting your account on your self-hosted server does not remove feedback you have sent
            to OpenBeacon. To have it removed, contact us using this form with the same email.
          </Text>
        )}
        <View className="gap-2">
          <TextInput
            accessibilityLabel="Feedback"
            multiline
            maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
            value={message}
            onChangeText={setMessage}
            placeholder="How can we help?"
            textAlignVertical="top"
            className="min-h-40 rounded-lg border border-border bg-input p-4 text-foreground placeholder:text-tertiary"
          />
          <Text className="self-end text-sm text-tertiary">
            {message.length}/{FEEDBACK_MESSAGE_MAX_LENGTH}
          </Text>
        </View>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: includeEmail }}
          onPress={() => setIncludeEmail(!includeEmail)}
          className="flex-row items-center gap-3"
        >
          <View className="size-6 items-center justify-center rounded border border-border">
            {includeEmail && <Icon as={CheckIcon} className="size-4 text-foreground" />}
          </View>
          <Text className="flex-1">
            Include my account email so the OpenBeacon team can follow up
          </Text>
        </Pressable>
        {includeEmail && !session && (
          <Text className="text-sm text-tertiary">
            Your account email isn't available yet. Sign in again, or untick this option to send
            without it.
          </Text>
        )}
        <Button onPress={submit} disabled={!canSubmit}>
          <Text>{submitting ? "Sending…" : "Send feedback"}</Text>
        </Button>
        {status === "success" && <Text>Feedback sent to OpenBeacon. Thank you.</Text>}
        {status === "error" && <Text>Could not send feedback. Please try again.</Text>}
        {status === "rateLimited" && (
          <Text>
            Thanks for all your feedback! We've received a lot from you recently, so please wait a
            little while before sending more.
          </Text>
        )}
      </ScrollView>
    </View>
  );
};

export default ContactUsScreen;
