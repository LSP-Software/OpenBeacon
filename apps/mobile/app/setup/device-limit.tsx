import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { ConfirmIdentity } from "../../components/ConfirmIdentity.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useIdentityGate } from "../../hooks/useIdentityGate.ts";
import { Alert } from "../../lib/alert.ts";
import { trpc } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { deviceIconFor } from "../../lib/deviceIcons.ts";
import { needsFreshSignIn } from "../../lib/needsFreshSignIn.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";
import { shortTimeSince } from "../../lib/timeSince.ts";

const DeviceLimitScreen = () => {
  const queryClient = useQueryClient();
  const noun = thisDeviceNoun();
  const [step, setStep] = useState<"verify" | "ready" | "removing">("verify");
  const gate = useIdentityGate();
  const devices = useQuery({
    ...trpc.device.devicesAtLimit.queryOptions(),
    enabled: step !== "verify",
  });
  const removeAtLimit = useMutation({
    ...trpc.device.removeAtLimit.mutationOptions(),
    networkMode: "always",
  });

  useEffect(() => {
    if (step === "verify" && gate.decision === "ready") setStep("ready");
  }, [step, gate.decision]);

  const finish = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.device.status.queryKey() });
    router.back();
  };

  const remove = async (device: { id: string; name: string }) => {
    setStep("removing");
    const result = await tryCatch(removeAtLimit.mutateAsync({ deviceId: device.id }));
    if (needsFreshSignIn(result.error)) {
      await gate.recheck();
      setStep("verify");
      Alert.alert("Sign in again", "Nothing was removed. Confirm it’s you, then try again.");
      return;
    }
    if (result.error) {
      setStep("ready");
      void devices.refetch();
      Alert.alert(
        `Unable to remove ${device.name}`,
        result.error instanceof TRPCClientError && result.error.data
          ? result.error.message
          : "Check your connection and try again.",
      );
      return;
    }
    finish();
    Alert.alert(
      `${device.name} was removed`,
      `It’s signed out and won’t receive new locations. You can set up this ${noun} now.`,
    );
  };

  const confirmRemove = (device: { id: string; name: string }) =>
    Alert.alert(
      `Remove ${device.name}?`,
      `${device.name} will be signed out, and it won’t receive new locations. Anything it has already seen can’t be taken back.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void remove(device) },
      ],
    );

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ gestureEnabled: step !== "removing" }} />
      <ScreenHeader title="Remove a device" hideBack={step === "removing"} />
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
          <Text className="text-secondary text-base">
            Your account has as many devices set up as it can have. Remove one you no longer use to
            set up this {noun}. It will be signed out and won’t receive new locations.
          </Text>

          {step === "verify" && gate.decision === null && <LoadingIndicator />}
          {step === "verify" && gate.decision === "confirm" && (
            <ConfirmIdentity
              onConfirmed={() => {
                void gate.refresh();
                setStep("ready");
              }}
            />
          )}

          {step !== "verify" && devices.isPending && <LoadingIndicator />}
          {step !== "verify" && devices.isError && (
            <View className="gap-4">
              <Text className="text-secondary text-base">
                We couldn’t load your devices. Check your connection and try again.
              </Text>
              <Button variant="secondary" onPress={() => devices.refetch()}>
                <Text>Try again</Text>
              </Button>
            </View>
          )}
          {step !== "verify" && devices.data?.length === 0 && (
            <View className="gap-4">
              <Text className="text-secondary text-base">
                Your account has room for this {noun} now.
              </Text>
              <Button onPress={finish}>
                <Text>Continue</Text>
              </Button>
            </View>
          )}
          {step !== "verify" && devices.data && devices.data.length > 0 && (
            <View className="overflow-hidden rounded-2xl border border-border bg-card">
              {devices.data.map((device, index) => {
                const lastActive = shortTimeSince(device.lastSeenAt);
                return (
                  <Pressable
                    key={device.id}
                    accessibilityRole="button"
                    accessibilityHint="Removes this device from your account"
                    disabled={step === "removing"}
                    onPress={() => confirmRemove(device)}
                    className={cn(
                      "flex-row items-center gap-4 px-5 py-4 active:bg-secondary/60",
                      index < devices.data.length - 1 && "border-b border-border/50",
                    )}
                  >
                    <Icon
                      as={deviceIconFor(device.icon, device.platform).icon}
                      className="text-primary size-5"
                    />
                    <View className="flex-1">
                      <Text className="text-foreground text-base font-medium">{device.name}</Text>
                      <Text className="text-tertiary text-sm">
                        {[
                          device.model,
                          lastActive === "now" ? "Active now" : `Last active ${lastActive} ago`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default DeviceLimitScreen;
