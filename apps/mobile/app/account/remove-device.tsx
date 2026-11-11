import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConfirmIdentity } from "../../components/ConfirmIdentity.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useIdentityGate } from "../../hooks/useIdentityGate.ts";
import { Alert } from "../../lib/alert.ts";
import { trpc } from "../../lib/api.ts";
import { needsFreshSignIn } from "../../lib/needsFreshSignIn.ts";

const RemoveDeviceScreen = () => {
  const { deviceId, name } = useLocalSearchParams<{ deviceId: string; name: string }>();
  const [step, setStep] = useState<"verify" | "ready" | "removing">("verify");
  const gate = useIdentityGate();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const removeDevice = useMutation({
    ...trpc.account.removeDevice.mutationOptions(),
    networkMode: "always",
  });

  useEffect(() => {
    if (step === "verify" && gate.decision === "ready") {
      setStep("ready");
    }
  }, [step, gate.decision]);

  const remove = async () => {
    setStep("removing");
    const result = await tryCatch(removeDevice.mutateAsync({ deviceId }));
    if (needsFreshSignIn(result.error)) {
      await gate.recheck();
      setStep("verify");
      Alert.alert("Sign in again", "Nothing was removed. Confirm it’s you, then try again.");
      return;
    }
    if (result.error) {
      setStep("ready");
      Alert.alert(
        "Unable to remove device",
        result.error instanceof TRPCClientError && result.error.data
          ? result.error.message
          : "Check your connection and try again.",
      );
      return;
    }
    await queryClient.invalidateQueries({ queryKey: trpc.account.listDevices.queryKey() });
    void queryClient.invalidateQueries({
      queryKey: trpc.groupMembership.listMemberDevices.pathKey(),
    });
    if (navigation.isFocused()) router.back();
    Alert.alert("Device removed", `${name} was signed out and won’t receive new locations.`);
  };

  const confirmRemove = () =>
    Alert.alert(
      `Remove ${name}?`,
      `${name} will be signed out, and it won’t receive new locations. Anything it has already seen can’t be taken back.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove device", style: "destructive", onPress: remove },
      ],
    );

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          {step === "removing" ? <View className="w-10" /> : <BackButton />}
          <Text className="text-foreground text-2xl font-bold">Remove device</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-6 px-6 py-6 pb-32"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="gap-2">
            <Text className="text-muted-foreground text-base leading-6">
              Remove {name} if it’s lost or stolen, or you don’t use it any more. It will be signed
              out, it won’t receive new locations, and it will delete its keys and data the next
              time it connects.
            </Text>
            <Text className="text-muted-foreground text-base leading-6">
              Anything it has already seen can’t be taken back. If someone else might know your
              password, change it too.
            </Text>
          </View>

          {step === "verify" && gate.decision === null && <LoadingIndicator />}
          {step === "verify" && gate.decision === "confirm" && (
            <ConfirmIdentity
              onConfirmed={() => {
                void gate.refresh();
                setStep("ready");
              }}
            />
          )}

          {(step === "ready" || step === "removing") && (
            <Button variant="destructive" onPress={confirmRemove} disabled={step === "removing"}>
              <Text>{step === "removing" ? "Removing…" : `Remove ${name}`}</Text>
            </Button>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default RemoveDeviceScreen;
