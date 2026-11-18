import { Alert } from "../lib/alert.ts";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Link, useLocalSearchParams } from "expo-router";
import { QrCodeIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "../components/headers/ScreenHeader.tsx";
import { InviteConfirmation } from "../components/InviteConfirmation.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import { Text } from "../components/ui/Text.tsx";
import { authClient } from "../lib/auth-client.ts";
import type { InviteToConfirm } from "../lib/inviteTypes.ts";
import { withOwnScreen } from "../lib/ownScreen.ts";
import { joinCodeFromInput } from "../lib/pendingJoinCode.ts";

const Join = () => {
  const params = useLocalSearchParams<{ code?: string; inviteId?: string }>();
  const [code, setCode] = useState(params.code ?? "");
  const [confirmingCode, setConfirmingCode] = useState(() =>
    params.code ? joinCodeFromInput(params.code) : null,
  );
  const [scanning, setScanning] = useState(false);
  const scanned = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const { data: session, isPending } = authClient.useSession();
  useEffect(() => {
    if (typeof params.code === "string") {
      setCode(params.code);
      setConfirmingCode(joinCodeFromInput(params.code));
      setScanning(false);
    }
  }, [params.code]);
  const review = (input: string, invalidMessage: string) => {
    const normalized = joinCodeFromInput(input);
    if (!normalized) {
      Alert.alert("Invalid code", invalidMessage);
      return;
    }
    setCode(normalized);
    setConfirmingCode(normalized);
  };
  const scan = async () => {
    if (scanning) {
      setScanning(false);
      return;
    }
    const granted = permission?.granted || (await withOwnScreen(requestPermission)).granted;
    if (!granted) {
      Alert.alert("Camera permission required", "Allow camera access to scan an invitation.");
      return;
    }
    scanned.current = false;
    setScanning(true);
  };
  const invite: InviteToConfirm | null = params.inviteId
    ? { kind: "email", inviteId: params.inviteId }
    : confirmingCode
      ? { kind: "code", code: confirmingCode }
      : null;
  if (session && invite) {
    return (
      <SafeAreaView className="flex-1 bg-background p-6">
        <InviteConfirmation
          key={JSON.stringify(invite)}
          invite={invite}
          onTryAnotherCode={() => setConfirmingCode(null)}
        />
      </SafeAreaView>
    );
  }
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Join a group" fallback="/(tabs)/groups/list" />
      <View className="gap-4 px-4 pt-2">
        {isPending ? (
          <Text>Loading...</Text>
        ) : !session ? (
          <>
            <Text className="text-secondary">Sign in to join this group.</Text>
            <Link href={{ pathname: "/signIn", params: { joinCode: code } }} asChild>
              <Button>
                <Text>Sign in</Text>
              </Button>
            </Link>
            <Link href={{ pathname: "/signUp", params: { joinCode: code } }} asChild>
              <Button variant="secondary">
                <Text>Create account</Text>
              </Button>
            </Link>
          </>
        ) : (
          <>
            {scanning ? (
              <View className="overflow-hidden rounded-2xl">
                <CameraView
                  style={{ height: 300 }}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={({ data }) => {
                    if (scanned.current) return;
                    scanned.current = true;
                    setScanning(false);
                    review(data, "That QR code isn’t an OpenBeacon invite.");
                  }}
                />
              </View>
            ) : null}
            <Button variant="secondary" onPress={scan}>
              <Icon as={QrCodeIcon} className="text-foreground size-5" />
              <Text>{scanning ? "Close scanner" : "Scan QR code"}</Text>
            </Button>
            <View className="gap-2 pt-2">
              <Text variant="label">Or enter a join code</Text>
              <TextInput
                accessibilityLabel="Join code"
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                autoCorrect={false}
                className="h-[52px] rounded-lg border border-border-strong bg-input px-4 text-base text-foreground"
              />
            </View>
            <Button onPress={() => review(code, "Enter the complete join code.")}>
              <Text>Continue</Text>
            </Button>
          </>
        )}
      </View>
    </View>
  );
};
export default Join;
