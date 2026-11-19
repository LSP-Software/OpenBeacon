import { tryCatch } from "@openbeacon/shared";
import { useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { Alert } from "../../lib/alert.ts";
import { trpc, trpcClient } from "../../lib/api.ts";
import { approveDeviceLink, lookUpDeviceLink } from "../../lib/deviceLink.ts";
import { errorReason } from "../../lib/errorReason.ts";
import { withOwnScreen } from "../../lib/ownScreen.ts";
import { userMessage } from "../../lib/userMessage.ts";

const AddDeviceScreen = () => {
  const queryClient = useQueryClient();
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<"scan" | "checking" | "confirm" | "approving" | "done">("scan");
  const [link, setLink] = useState<Awaited<ReturnType<typeof lookUpDeviceLink>> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const scanned = useRef(false);

  const refreshDevices = () =>
    queryClient.invalidateQueries({ queryKey: trpc.account.listDevices.queryKey() });

  const check = async (code: string) => {
    if (scanned.current) return;
    scanned.current = true;
    setProblem(null);
    setStep("checking");
    const result = await tryCatch(lookUpDeviceLink(code));
    if (result.error) {
      setProblem(userMessage(result.error));
      setStep("scan");
      return;
    }
    setLink(result.data);
    setStep("confirm");
  };

  const scanAgain = () => {
    scanned.current = false;
    setLink(null);
    setProblem(null);
    setStep("scan");
  };

  const codeNoLongerValid = (error: Error) => {
    const reason = errorReason(error);
    return reason === "CODE_EXPIRED" || reason === "ALREADY_SET_UP";
  };

  const approve = async () => {
    if (!link) return;
    setStep("approving");
    const result = await tryCatch(approveDeviceLink(link));
    if (result.error && codeNoLongerValid(result.error)) {
      scanAgain();
      setProblem(userMessage(result.error));
      return;
    }
    if (result.error) {
      setStep("confirm");
      Alert.alert(`Couldn’t add ${link.device.name}`, userMessage(result.error));
      return;
    }
    await refreshDevices();
    setStep("done");
  };

  const decline = async () => {
    if (!link) return;
    setStep("approving");
    const result = await tryCatch(trpcClient.deviceLink.decline.mutate({ linkId: link.linkId }));
    if (result.error && codeNoLongerValid(result.error)) {
      scanAgain();
      setProblem(userMessage(result.error));
      return;
    }
    if (result.error) {
      setStep("confirm");
      Alert.alert(`Couldn’t remove ${link.device.name}`, userMessage(result.error));
      return;
    }
    await refreshDevices();
    Alert.alert(
      `${link.device.name} was removed`,
      "It’s signed out and can’t see anyone’s location. If you didn’t sign in on it, change your password.",
    );
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Add a device" hideBack={step === "approving"} />
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-4 pb-16 pt-2"
        showsVerticalScrollIndicator={false}
      >
        {(step === "scan" || step === "checking") && (
          <View className="gap-4">
            <Text className="text-secondary text-base">
              On the new phone or tablet, sign in and choose “Link with your other device”. Then
              scan the code it shows.
            </Text>
            {problem && <Text className="text-destructive-text text-base">{problem}</Text>}
            {permission?.granted ? (
              <View
                accessible
                accessibilityLabel="Camera. Point it at the code on the new device."
                className="overflow-hidden rounded-2xl"
              >
                <CameraView
                  style={{ height: 320 }}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={step === "scan" ? ({ data }) => void check(data) : undefined}
                />
              </View>
            ) : permission && !permission.canAskAgain ? (
              <View className="gap-4">
                <Text className="text-secondary text-base">
                  OpenBeacon isn’t allowed to use the camera. Turn on camera access in Settings to
                  scan the code.
                </Text>
                <Button onPress={() => void tryCatch(Linking.openSettings())}>
                  <Text>Open settings</Text>
                </Button>
              </View>
            ) : (
              <Button
                onPress={async () => {
                  if (!(await withOwnScreen(requestPermission)).granted) {
                    Alert.alert(
                      "Camera permission required",
                      "Allow camera access to scan the code on the new device.",
                    );
                  }
                }}
              >
                <Text>Scan the code</Text>
              </Button>
            )}
            {problem && (
              <Button variant="secondary" onPress={scanAgain}>
                <Text>Scan again</Text>
              </Button>
            )}
          </View>
        )}

        {(step === "confirm" || step === "approving") && link && (
          <View className="gap-4">
            <Text className="text-foreground text-2xl font-bold">
              Add {link.device.name} to your account?
            </Text>
            <Text className="text-secondary text-base">
              It will see your groups’ locations and your history.
              {link.device.model && link.device.model !== link.device.name
                ? ` It’s a ${link.device.model}.`
                : ""}
            </Text>
            <Button onPress={approve} loading={step === "approving"}>
              <Text>Add</Text>
            </Button>
            <Button variant="secondary" onPress={decline} disabled={step === "approving"}>
              <Text>Not me</Text>
            </Button>
          </View>
        )}

        {step === "done" && link && (
          <View className="gap-4">
            <Text className="text-foreground text-2xl font-bold">{link.device.name} is set up</Text>
            <Text className="text-secondary text-base">
              It now has your location history and will see your groups’ locations shortly.
            </Text>
            <Button onPress={() => router.back()}>
              <Text>Done</Text>
            </Button>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

export default AddDeviceScreen;
