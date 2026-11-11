import { tryCatch } from "@openbeacon/shared";
import { useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { Alert } from "../../lib/alert.ts";
import { trpc, trpcClient } from "../../lib/api.ts";
import { approveDeviceLink, lookUpDeviceLink } from "../../lib/deviceLink.ts";

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
      setProblem(result.error.message);
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

  const approve = async () => {
    if (!link) return;
    setStep("approving");
    const result = await tryCatch(approveDeviceLink(link));
    if (result.error) {
      setStep("confirm");
      Alert.alert(`Unable to add ${link.device.name}`, result.error.message);
      return;
    }
    await refreshDevices();
    setStep("done");
  };

  const decline = async () => {
    if (!link) return;
    setStep("approving");
    const result = await tryCatch(trpcClient.deviceLink.decline.mutate({ linkId: link.linkId }));
    if (result.error) {
      setStep("confirm");
      Alert.alert(`Unable to remove ${link.device.name}`, result.error.message);
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
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          {step === "approving" ? <View className="w-10" /> : <BackButton />}
          <Text className="text-foreground text-2xl font-bold">Add a device</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-6 py-6 pb-16"
        showsVerticalScrollIndicator={false}
      >
        {(step === "scan" || step === "checking") && (
          <View className="gap-4">
            <Text className="text-muted-foreground text-base leading-6">
              On your new phone, sign in and choose “Yes, link with your other phone”. Then scan the
              code it shows.
            </Text>
            {problem && <Text className="text-destructive text-base leading-6">{problem}</Text>}
            {permission?.granted ? (
              <View
                accessible
                accessibilityLabel="Camera. Point it at the code on your new phone."
                className="overflow-hidden rounded-3xl"
              >
                <CameraView
                  style={{ height: 320 }}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={step === "scan" ? ({ data }) => void check(data) : undefined}
                />
              </View>
            ) : permission && !permission.canAskAgain ? (
              <View className="gap-4">
                <Text className="text-muted-foreground text-base leading-6">
                  OpenBeacon isn’t allowed to use the camera. Turn on camera access in Settings to
                  scan the code.
                </Text>
                <Button onPress={() => void tryCatch(Linking.openSettings())}>
                  <Text>Open Settings</Text>
                </Button>
              </View>
            ) : (
              <Button
                onPress={async () => {
                  if (!(await requestPermission()).granted) {
                    Alert.alert(
                      "Camera permission required",
                      "Allow camera access to scan the code on your new phone.",
                    );
                  }
                }}
              >
                <Text>Scan the code</Text>
              </Button>
            )}
            {problem && (
              <Button variant="outline" onPress={scanAgain}>
                <Text>Scan again</Text>
              </Button>
            )}
          </View>
        )}

        {(step === "confirm" || step === "approving") && link && (
          <View className="gap-4">
            <Text className="text-foreground text-3xl font-bold">
              Add {link.device.name} to your account?
            </Text>
            <Text className="text-muted-foreground text-base leading-6">
              It will see your groups’ locations and your history.
              {link.device.model && link.device.model !== link.device.name
                ? ` It’s a ${link.device.model}.`
                : ""}
            </Text>
            <Button onPress={approve} loading={step === "approving"}>
              <Text>Add</Text>
            </Button>
            <Button variant="destructive" onPress={decline} disabled={step === "approving"}>
              <Text>Not me</Text>
            </Button>
          </View>
        )}

        {step === "done" && link && (
          <View className="gap-4">
            <Text className="text-foreground text-3xl font-bold">{link.device.name} is set up</Text>
            <Text className="text-muted-foreground text-base leading-6">
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
