import { Alert } from "../../lib/alert.ts";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { RadioCardGroup } from "../../components/ui/RadioCardGroup.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";

const DeleteAccountScreen = () => {
  const requestDeletion = useMutation(trpc.account.requestDeletion.mutationOptions());
  const beginGoogleVerification = useMutation(
    trpc.account.beginGoogleDeletionVerification.mutationOptions(),
  );
  const verificationMethods = useQuery(trpc.account.deletionVerificationMethods.queryOptions());
  const [isGoogleVerifying, setIsGoogleVerifying] = useState(false);
  const [immediate, setImmediate] = useState(false);
  const deletionForm = useForm<{ password: string }>({ defaultValues: { password: "" } });

  const requestAccountDeletion = (
    verification: { password: string } | { google: { state: string; code: string } },
  ) => {
    Alert.alert(
      "Delete account?",
      immediate
        ? "Your account cannot be recovered. Deletion starts immediately."
        : "You will be signed out on all devices. Sign in within seven days to cancel deletion. After that, your account cannot be recovered.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: async () => {
            const result = await tryCatch(
              requestDeletion.mutateAsync({ ...verification, immediate }),
            );
            deletionForm.reset();
            if (result.error) {
              Alert.alert("Unable to delete account", result.error.message);
              return;
            }
            await tryCatch(authClient.signOut());
            router.replace("/");
            Alert.alert(
              "Account deletion requested",
              immediate
                ? "Your account deletion has started."
                : "Sign in within seven days to cancel deletion.",
            );
          },
        },
      ],
    );
  };

  const verifyWithGoogle = async () => {
    if (isGoogleVerifying) return;
    setIsGoogleVerifying(true);
    const authorization = await tryCatch(beginGoogleVerification.mutateAsync());
    if (authorization.error) {
      setIsGoogleVerifying(false);
      Alert.alert("Google verification failed", "Please try again.");
      return;
    }
    const result = await tryCatch(
      WebBrowser.openAuthSessionAsync(authorization.data.url, "openbeacon://google-deletion"),
    );
    setIsGoogleVerifying(false);
    if (result.error) {
      Alert.alert("Google verification failed", "Please try again.");
      return;
    }
    if (result.data.type !== "success") return;
    const resultUrl = result.data.url;
    const parsed = await tryCatch(Promise.resolve().then(() => new URL(resultUrl)));
    const callback = parsed.data;
    const state = callback?.searchParams.get("state");
    const code = callback?.searchParams.get("code");
    if (
      callback?.protocol !== "openbeacon:" ||
      callback.hostname !== "google-deletion" ||
      state !== authorization.data.state ||
      !code
    ) {
      Alert.alert("Google verification failed", "Please try again.");
      return;
    }
    requestAccountDeletion({ google: { state, code } });
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          <BackButton />
          <Text className="text-foreground text-2xl font-bold">Delete account</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>
      <ScrollView contentContainerClassName="gap-4 p-6">
        <Text>
          You will be signed out on all devices. Your account and its data will be permanently
          deleted and cannot be recovered after deletion.
        </Text>
        <Text>
          Groups where you are the only member will be deleted. Transfer ownership or delete groups
          where you are the only owner before continuing.
        </Text>
        <Text className="font-semibold">Choose when to delete your account:</Text>
        <RadioCardGroup
          accessibilityLabel="Deletion timing"
          options={[
            {
              value: false,
              title: "After 7 days",
              description:
                "Sign in within 7 days to cancel deletion. After the grace period your account cannot be recovered.",
            },
            {
              value: true,
              title: "Delete immediately",
              description: "Deletion starts right away and cannot be cancelled or reversed.",
            },
          ]}
          selected={immediate}
          onChange={setImmediate}
        />
        <View className="gap-4">
          {verificationMethods.data?.password && (
            <>
              <Input
                control={deletionForm.control}
                name="password"
                label="Password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
              />
              <Button
                variant="destructive"
                onPress={deletionForm.handleSubmit(requestAccountDeletion)}
                disabled={requestDeletion.isPending || isGoogleVerifying}
              >
                <Text>Confirm deletion</Text>
              </Button>
            </>
          )}
          {verificationMethods.data?.google && (
            <Button
              onPress={verifyWithGoogle}
              disabled={requestDeletion.isPending || isGoogleVerifying}
            >
              <Text>Verify with Google</Text>
            </Button>
          )}
          {verificationMethods.isError && (
            <Text>Unable to load verification methods. Please try again.</Text>
          )}
          {verificationMethods.data &&
            !verificationMethods.data.password &&
            !verificationMethods.data.google && (
              <Text>No verification method is available. Please contact support.</Text>
            )}
          <Button variant="outline" onPress={() => router.back()}>
            <Text>Cancel</Text>
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default DeleteAccountScreen;
