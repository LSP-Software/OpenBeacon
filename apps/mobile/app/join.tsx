import { Alert } from "../lib/alert.ts";
import { tryCatch } from "@openbeacon/shared";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Link, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/ui/Button.tsx";
import { Text } from "../components/ui/Text.tsx";
import { queryClient, trpcClient } from "../lib/api.ts";
import { authClient } from "../lib/auth-client.ts";
import { buildAcceptSharedInviteInput, submitEpochChange } from "../lib/groupEncryption.ts";
import { groupLimitAlert } from "../lib/groupLimitAlert.ts";
import { requestTrackingSync } from "../lib/trackingEvents.ts";
import { useSingleFlight } from "../lib/useSingleFlight.ts";

const Join = () => {
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(params.code ?? "");
  const [scanning, setScanning] = useState(false);
  const submission = useSingleFlight<string>();
  const [permission, requestPermission] = useCameraPermissions();
  const { data: session, isPending } = authClient.useSession();
  useEffect(() => {
    if (typeof params.code === "string") {
      setCode(params.code);
      setScanning(false);
    }
  }, [params.code]);
  const join = async () => {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-F0-9]{32}$/.test(normalized)) {
      Alert.alert("Invalid code", "Enter the complete join code.");
      return;
    }
    await submission.run(normalized, async () => {
      const result = await tryCatch(
        (async () => {
          await submitEpochChange({
            build: () => buildAcceptSharedInviteInput({ code: normalized }),
            submit: (input) => trpcClient.groupInvites.acceptShared.mutate(input),
          });
        })(),
      );
      const limit = groupLimitAlert(result.error);
      if (limit) {
        Alert.alert(limit.title, limit.message);
        return;
      }
      if (result.error) {
        Alert.alert("Unable to join", result.error.message);
        return;
      }
      await queryClient.invalidateQueries();
      requestTrackingSync();
      router.replace("/(tabs)/groups/list");
    });
  };
  const scan = async () => {
    if (scanning) {
      setScanning(false);
      return;
    }
    const granted = permission?.granted || (await requestPermission()).granted;
    if (granted) setScanning(true);
    else Alert.alert("Camera permission required", "Allow camera access to scan an invitation.");
  };
  return (
    <SafeAreaView className="flex-1 bg-background p-6">
      <View className="gap-4">
        <Text className="text-3xl font-bold">Join a group</Text>
        {isPending ? (
          <Text>Loading...</Text>
        ) : !session ? (
          <>
            <Text>Sign in to join this group.</Text>
            <Link href={{ pathname: "/signIn", params: { joinCode: code } }} asChild>
              <Button>
                <Text>Sign in</Text>
              </Button>
            </Link>
            <Link href={{ pathname: "/signUp", params: { joinCode: code } }} asChild>
              <Button variant="outline">
                <Text>Create account</Text>
              </Button>
            </Link>
          </>
        ) : (
          <>
            {scanning ? (
              <CameraView
                style={{ height: 300 }}
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => {
                  setScanning(false);
                  setCode(data);
                }}
              />
            ) : null}
            <Button variant="outline" onPress={scan}>
              <Text>{scanning ? "Close scanner" : "Scan QR code"}</Text>
            </Button>
            <TextInput
              accessibilityLabel="Join code"
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              className="rounded-lg border border-border bg-input text-foreground placeholder:text-secondary dark:placeholder:text-muted-foreground p-4"
              placeholder="Enter join code"
            />
            <Button onPress={join} loading={submission.isPending}>
              <Text>Join group</Text>
            </Button>
            <Link href="/(tabs)/groups/list" asChild>
              <Button variant="secondary">
                <Text className="dark:text-white">Cancel</Text>
              </Button>
            </Link>
          </>
        )}
      </View>
    </SafeAreaView>
  );
};
export default Join;
