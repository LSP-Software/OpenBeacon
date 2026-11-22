import { tryCatch } from "@openbeacon/shared";
import { Alert } from "../lib/alert.ts";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { Link, router, useLocalSearchParams, Stack } from "expo-router";
import { CheckIcon, ClipboardPasteIcon, QrCodeIcon, XIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "../components/headers/ScreenHeader.tsx";
import { InviteConfirmation } from "../components/InviteConfirmation.tsx";
import { JoinCodeGrid } from "../components/JoinCodeGrid.tsx";
import { KeyboardFormScrollView } from "../components/KeyboardFormScrollView.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import { Text } from "../components/ui/Text.tsx";
import { useServerChange } from "../hooks/useServerChange.ts";
import { authClient } from "../lib/auth-client.ts";
import { getSelectedServerUrl, isHostedServer, normaliseServerUrl } from "../lib/currentServer.ts";
import type { InviteToConfirm, ReadInvite } from "../lib/inviteTypes.ts";
import { withOwnScreen } from "../lib/ownScreen.ts";
import { cn } from "../lib/cn.ts";
import { joinCodeCharacters, joinInviteFromInput } from "../lib/inviteLink.ts";
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
  const [code, setCode] = useState(joinCodeCharacters(codeParam ?? ""));
  const [codeFocused, setCodeFocused] = useState(false);
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
    setCode(joinCodeCharacters(codeParam ?? ""));
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
  const enterCode = (text: string) => {
    const added = text.startsWith(code) ? text.slice(code.length) : text;
    if (added.length <= 1 || /^[0-9a-f\s-]*$/i.test(added)) {
      setCode(joinCodeCharacters(text));
      return;
    }
    if (joinInviteFromInput(added)) review(added, "typed");
    else Alert.alert("Invalid code", "That isn’t a join code or invite link.");
  };
  const paste = async () => {
    const pasted = await tryCatch(Clipboard.getStringAsync());
    const text = pasted.data?.trim();
    if (pasted.error || !text) {
      Alert.alert("Nothing to paste", "Copy the join code or invite link first.");
      return;
    }
    if (joinInviteFromInput(text)) {
      review(text, "typed");
      return;
    }
    Alert.alert("Invalid code", "That isn’t a join code or invite link.");
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
            <View className="rounded-3xl bg-warning p-4">
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
        <Stack.Screen options={{ headerShown: false }} />
        <InviteConfirmation
          key={JSON.stringify(invite)}
          invite={invite}
          onTryAnotherCode={() => {
            setCode("");
            setOpened(null);
          }}
        />
      </SafeAreaView>
    );
  }
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Join a group" fallback={fallback} />
      <KeyboardFormScrollView contentContainerClassName="px-4 pb-8 pt-4">
        {(form) => (
          <View ref={form.ref} onLayout={form.onLayout} className="gap-4">
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
                <View className="gap-3 rounded-3xl bg-card p-4">
                  <View className="flex-row items-center gap-3">
                    <View className="size-12 items-center justify-center rounded-lg bg-primary-soft">
                      <Icon as={QrCodeIcon} className="text-primary-text size-6" />
                    </View>
                    <View className="flex-1">
                      <Text className="font-semibold">Scan a QR code</Text>
                      <Text className="text-sm text-secondary">
                        Point your camera at their invite
                      </Text>
                    </View>
                    <Button variant="secondary" size="sm" hitSlop={8} onPress={scan}>
                      <Text>{scanning ? "Close" : "Scan"}</Text>
                    </Button>
                  </View>
                  {scanning ? (
                    <View className="overflow-hidden rounded-lg">
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
                </View>
                <View className="flex-row items-center gap-3">
                  <View className="h-px flex-1 bg-border" />
                  <Text className="text-sm text-tertiary">or</Text>
                  <View className="h-px flex-1 bg-border" />
                </View>
                <View className="gap-2">
                  <View className="flex-row items-center justify-between">
                    <Text variant="label">Join code</Text>
                    {code.length === 32 ? (
                      <View className="flex-row items-center gap-1">
                        <Icon as={CheckIcon} className="text-success size-4" />
                        <Text className="text-sm text-secondary">32 of 32</Text>
                      </View>
                    ) : code ? (
                      <Text className="text-sm text-tertiary">{`${code.length} of 32`}</Text>
                    ) : null}
                  </View>
                  <View
                    className={cn(
                      "flex-row items-center gap-2 rounded-lg border bg-input py-3 pl-4 pr-1",
                      codeFocused ? "border-primary" : "border-border-strong",
                    )}
                  >
                    <View className="flex-1">
                      <JoinCodeGrid code={code} hidden />
                      <TextInput
                        accessibilityLabel="Join code"
                        accessibilityHint="32 characters, 0 to 9 and A to F"
                        value={code}
                        selection={{ start: code.length, end: code.length }}
                        // Fabric treats a colour of 0 ("transparent") as unset, so the default would show
                        selectionColor="#00000001"
                        contextMenuHidden
                        onChangeText={enterCode}
                        onFocus={() => setCodeFocused(true)}
                        onBlur={() => setCodeFocused(false)}
                        onSubmitEditing={() => review(code, "typed")}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        spellCheck={false}
                        autoComplete="off"
                        importantForAutofill="no"
                        caretHidden
                        className="absolute inset-0"
                        style={{ color: "#00000001", fontSize: 1 }}
                      />
                    </View>
                    {code ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-3"
                        hitSlop={8}
                        accessibilityLabel="Clear join code"
                        onPress={() => setCode("")}
                      >
                        <Icon as={XIcon} className="text-primary-text size-5" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-3"
                        hitSlop={8}
                        onPress={paste}
                      >
                        <Icon as={ClipboardPasteIcon} className="text-primary-text size-4" />
                        <Text>Paste</Text>
                      </Button>
                    )}
                  </View>
                  <Text className="text-sm text-secondary">
                    32 characters, 0–9 and A–F, from the person inviting you. You can paste their
                    invite link or message too.
                  </Text>
                </View>
                <Button disabled={code.length !== 32} onPress={() => review(code, "typed")}>
                  <Text>Continue</Text>
                </Button>
              </>
            )}
          </View>
        )}
      </KeyboardFormScrollView>
    </View>
  );
};
export default Join;
