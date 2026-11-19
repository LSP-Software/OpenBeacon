import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { ConfirmIdentity } from "../../components/ConfirmIdentity.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useIdentityGate } from "../../hooks/useIdentityGate.ts";
import { Alert } from "../../lib/alert.ts";
import { trpc } from "../../lib/api.ts";
import { needsFreshSignIn } from "../../lib/needsFreshSignIn.ts";
import { userMessage } from "../../lib/userMessage.ts";

const RemoveDeviceScreen = () => {
  const { deviceId } = useLocalSearchParams<{ deviceId: string }>();
  const devices = useQuery(trpc.account.listDevices.queryOptions());
  const device = devices.data?.find((item) => item.id === deviceId);
  const name = device?.name ?? "the device";
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
    const removedName = name;
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
      Alert.alert("Couldn’t remove device", userMessage(result.error));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: trpc.account.listDevices.queryKey() });
    void queryClient.invalidateQueries({
      queryKey: trpc.groupMembership.listMemberDevices.pathKey(),
    });
    if (navigation.isFocused()) router.back();
    Alert.alert("Device removed", `${removedName} was signed out and won’t receive new locations.`);
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
      <ScreenHeader title="Remove device" hideBack={step === "removing"} />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-6 px-4 pb-32 pt-2"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="gap-2">
            <Text className="text-secondary text-base">
              Remove {name} if it’s lost or stolen, or you don’t use it any more. It will be signed
              out, it won’t receive new locations, and it will delete its keys and data the next
              time it connects.
            </Text>
            <Text className="text-secondary text-base">
              Anything it has already seen can’t be taken back. If someone else might know your
              password, change it too.
            </Text>
          </View>

          {devices.isPending && <LoadingIndicator />}
          {devices.isError && !devices.data && (
            <>
              <Text className="text-tertiary">
                We couldn’t load your devices. Check your connection and try again.
              </Text>
              <Button variant="secondary" onPress={() => devices.refetch()}>
                <Text>Try again</Text>
              </Button>
            </>
          )}
          {devices.data && !device && step !== "removing" && (
            <Text className="text-tertiary">That device is no longer on your account.</Text>
          )}
          {device && step === "verify" && gate.decision === null && <LoadingIndicator />}
          {device && step === "verify" && gate.decision === "confirm" && (
            <ConfirmIdentity
              onConfirmed={() => {
                void gate.refresh();
                setStep("ready");
              }}
            />
          )}

          {(step === "removing" || (device && step === "ready")) && (
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
