import { tryCatch } from "@openbeacon/shared";
import { Alert } from "../lib/alert.ts";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Link, router, useLocalSearchParams } from "expo-router";
import { QrCodeIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "../components/headers/ScreenHeader.tsx";
import { InviteConfirmation } from "../components/InviteConfirmation.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import { Text } from "../components/ui/Text.tsx";
import { useServerChange } from "../hooks/useServerChange.ts";
import { authClient } from "../lib/auth-client.ts";
import { getSelectedServerUrl, isHostedServer, normaliseServerUrl } from "../lib/currentServer.ts";
import type { InviteToConfirm, ReadInvite } from "../lib/inviteTypes.ts";
import { withOwnScreen } from "../lib/ownScreen.ts";
import { joinInviteFromInput } from "../lib/inviteLink.ts";
import { clearInviteForSignIn, saveInviteForSignIn } from "../lib/pendingJoinCode.ts";
import { thisDeviceNoun } from "../lib/thisDeviceNoun.ts";

const plainParam = (value: string | string[] | undefined) =>
  value === undefined ? undefined : typeof value === "string" ? value : null;

const inviteFromParams = (
  code: string | null | undefined,
  server: string | null | undefined,
): ReadInvite | null => {
  if (!code || server === null) return null;
  const read = joinInviteFromInput(code);
  if (!read?.invite || server === undefined) return read;
  const normalised = normaliseServerUrl(server);
  return normalised.url === null
    ? { invite: null, error: normalised.error }
    : { invite: { ...read.invite, server: normalised.url }, error: null };
};

const serverHost = (url: string) =>
  isHostedServer(url) ? "OpenBeacon’s hosted server" : new URL(url).host;

const Join = () => {
  const params = useLocalSearchParams<{
    code?: string | string[];
    inviteId?: string | string[];
    server?: string | string[];
  }>();
  const codeParam = plainParam(params.code);
  const serverParam = plainParam(params.server);
  const inviteId = plainParam(params.inviteId);
  const [code, setCode] = useState(codeParam ?? "");
  const [opened, setOpened] = useState(() => inviteFromParams(codeParam, serverParam));
  const [switching, setSwitching] = useState(false);
  const busy = useRef(false);
  const onScreen = useRef(true);
  const shownInvite = useRef(0);
  const [scanning, setScanning] = useState(false);
  const scanned = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const { data: session, isPending } = authClient.useSession();
  const { changeServerForInvite } = useServerChange();
  const fallback = session ? "/(tabs)/groups/list" : "/";
  useEffect(() => {
    onScreen.current = true;
    return () => {
      onScreen.current = false;
    };
  }, []);
  useEffect(() => {
    if (codeParam === undefined) return;
    setCode(codeParam ?? "");
    shownInvite.current += 1;
    setOpened(inviteFromParams(codeParam, serverParam));
    setScanning(false);
  }, [codeParam, serverParam]);
  const review = (input: string, from: "scan" | "typed") => {
    const read = joinInviteFromInput(input);
    if (!read?.invite) {
      Alert.alert(
        "Invalid code",
        read
          ? `That ${from === "scan" ? "QR code’s" : "invite’s"} server address can’t be used. Ask for a new invite.`
          : from === "scan"
            ? "That QR code isn’t an OpenBeacon invite."
            : "Enter the complete join code.",
      );
      return;
    }
    shownInvite.current += 1;
    setCode(read.invite.code);
    setOpened(read);
  };
  const leave = () => (router.canGoBack() ? router.back() : router.replace(fallback));
  const switchServer = async ({ code: inviteCode, server }: { code: string; server: string }) => {
    if (busy.current) return;
    busy.current = true;
    setSwitching(true);
    const invite = shownInvite.current;
    const changed = await tryCatch(
      changeServerForInvite(
        server,
        () => onScreen.current && shownInvite.current === invite,
        () => saveInviteForSignIn(inviteCode),
      ),
    );
    busy.current = false;
    if (changed.error || onScreen.current) clearInviteForSignIn();
    if (onScreen.current) setSwitching(false);
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
  const currentServer = getSelectedServerUrl();
  const currentName = serverHost(currentServer);
  if (opened && !opened.invite) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Join a group" fallback={fallback} />
        <View className="gap-4 px-4 pt-2">
          <Text accessibilityRole="header" className="text-xl font-semibold">
            This invite can’t be used
          </Text>
          <Text className="text-secondary">
            It points to a server address the app can’t use. Ask for a new invite.
          </Text>
          <Button onPress={leave}>
            <Text>Go back</Text>
          </Button>
        </View>
      </View>
    );
  }
  const inviteServer = opened?.invite.server;
  const inviteCode = opened?.invite.code;
  if (inviteCode && inviteServer && inviteServer !== currentServer) {
    const host = serverHost(inviteServer);
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Join a group" fallback={fallback} />
        <ScrollView contentContainerClassName="gap-4 px-4 pb-8 pt-2">
          <Text accessibilityRole="header" className="text-xl font-semibold">
            This invite is for another server
          </Text>
          <View className="gap-1">
            <Text
              selectable
              accessibilityLabel={`The invite’s server is ${host}`}
              className="text-2xl font-bold"
            >
              {host}
            </Text>
            {inviteServer !== `https://${new URL(inviteServer).host}` ? (
              <Text selectable className="text-sm text-secondary">
                {inviteServer}
              </Text>
            ) : null}
          </View>
          {!isHostedServer(inviteServer) && host.toLowerCase().includes("openbeacon") ? (
            <Text className="font-semibold">This isn’t OpenBeacon’s hosted server.</Text>
          ) : null}
          <Text className="text-secondary">
            {`You’re using ${currentName}. OpenBeacon uses one server at a time.`}
          </Text>
          {session || isPending ? (
            <Text className="text-secondary">
              {`Changing server signs you out on this ${thisDeviceNoun()}, and your groups on ${currentName} stop seeing your location. You’ll need an account on the new server. You can change back later from the sign-in screen.`}
            </Text>
          ) : null}
          {isHostedServer(inviteServer) ? null : (
            <View className="rounded-2xl border border-warning-border bg-warning p-4">
              <Text className="text-warning-text">
                Only change server if someone you know runs it and sent you this invite themselves.
                Never use the password from another account there.
              </Text>
            </View>
          )}
          <Button
            loading={switching}
            onPress={() => void switchServer({ code: inviteCode, server: inviteServer })}
          >
            <Text>Change server</Text>
          </Button>
          <Button variant="secondary" onPress={leave}>
            <Text>Don’t change</Text>
          </Button>
        </ScrollView>
      </View>
    );
  }
  const invite: InviteToConfirm | null = inviteId
    ? { kind: "email", inviteId }
    : opened?.invite
      ? { kind: "code", code: opened.invite.code }
      : null;
  if (session && invite) {
    return (
      <SafeAreaView className="flex-1 bg-background p-6">
        <InviteConfirmation
          key={JSON.stringify(invite)}
          invite={invite}
          onTryAnotherCode={() => setOpened(null)}
        />
      </SafeAreaView>
    );
  }
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Join a group" fallback={fallback} />
      <View className="gap-4 px-4 pt-2">
        {isPending ? (
          <Text>Loading...</Text>
        ) : !session ? (
          <>
            <Text className="text-secondary" accessibilityLiveRegion="polite">
              {isHostedServer(currentServer)
                ? "Sign in to join this group."
                : `Sign in or create an account on ${currentName} to join this group. An account on another server won’t work here.`}
            </Text>
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
                    review(data, "scan");
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
            <Button onPress={() => review(code, "typed")}>
              <Text>Continue</Text>
            </Button>
          </>
        )}
      </View>
    </View>
  );
};
export default Join;
