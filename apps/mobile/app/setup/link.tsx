import { createDeviceLinkSecret, formatDeviceLinkCode } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  allowScreenCaptureAsync,
  disableAppSwitcherProtectionAsync,
  enableAppSwitcherProtectionAsync,
  preventScreenCaptureAsync,
} from "expo-screen-capture";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";
import { ensureDeviceKeyRegistration } from "../../lib/deviceKeys.ts";
import { finishDeviceLink } from "../../lib/deviceLink.ts";
import { resealPersonalData } from "../../lib/resealPersonalData.ts";
import { requestTrackingSync } from "../../lib/trackingEvents.ts";

const LinkWithOtherPhoneScreen = () => {
  const queryClient = useQueryClient();
  const createLink = useMutation(trpc.deviceLink.create.mutationOptions());
  const [link, setLink] = useState<{
    devicePublicKey: string;
    linkId: string;
    psk: Uint8Array;
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const finishing = useRef(false);
  const status = useQuery({
    ...trpc.deviceLink.status.queryOptions({ linkId: link?.linkId ?? "" }),
    enabled: link !== null && problem === null,
    refetchInterval: (query) => (query.state.data?.state === "waiting" ? 2_000 : false),
  });

  const showNewCode = async () => {
    setProblem(null);
    setLink(null);
    finishing.current = false;
    const created = await tryCatch(
      Promise.all([ensureDeviceKeyRegistration(), createLink.mutateAsync()]),
    );
    if (created.error) {
      setProblem("We couldn’t reach your server. Check your connection and try again.");
      return;
    }
    const [device, { linkId }] = created.data;
    setLink({ devicePublicKey: device.publicKey, linkId, psk: createDeviceLinkSecret() });
  };

  useEffect(() => {
    void showNewCode();
  }, []);

  useEffect(() => {
    void tryCatch(preventScreenCaptureAsync("device-link"));
    void tryCatch(enableAppSwitcherProtectionAsync());
    return () => {
      void tryCatch(allowScreenCaptureAsync("device-link"));
      void tryCatch(disableAppSwitcherProtectionAsync());
    };
  }, []);

  useEffect(() => {
    const data = status.data;
    if (!link || data?.state !== "approved" || finishing.current) return;
    finishing.current = true;
    void (async () => {
      const finished = await tryCatch(
        finishDeviceLink({ ...data, linkId: link.linkId, psk: link.psk }),
      );
      if (finished.error) {
        setProblem(finished.error.message);
        return;
      }
      await queryClient.invalidateQueries();
      requestTrackingSync();
      await tryCatch(resealPersonalData(finished.data.userId));
      router.replace("/setup/name");
    })();
  }, [link, queryClient, status.data]);

  const approved = status.data?.state === "approved";
  const expired = status.data?.state === "expired";

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          <BackButton />
          <Text className="text-foreground text-2xl font-bold">Set up</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-6 py-6 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-foreground text-3xl font-bold">Link with your other phone</Text>
        <Text className="text-muted-foreground text-base leading-6">
          Open OpenBeacon on your other phone and scan this code. You’ll find the scanner in Account
          → Devices → Add a device.
        </Text>

        {problem ? (
          <View className="gap-4">
            <Text className="text-destructive text-base leading-6">{problem}</Text>
            {approved ? (
              <Button onPress={() => router.replace("/setup/name")}>
                <Text>Continue</Text>
              </Button>
            ) : (
              <Button onPress={showNewCode}>
                <Text>Try again</Text>
              </Button>
            )}
          </View>
        ) : approved ? (
          <View className="items-center gap-4">
            <LoadingIndicator />
            <Text className="text-muted-foreground text-base">Setting up this phone…</Text>
          </View>
        ) : expired ? (
          <View className="gap-4">
            <Text className="text-muted-foreground text-base leading-6">
              This code has expired. Codes only work for 10 minutes.
            </Text>
            <Button onPress={showNewCode} loading={createLink.isPending}>
              <Text>Show a new code</Text>
            </Button>
          </View>
        ) : link ? (
          <View className="items-center gap-4">
            <View className="rounded-3xl bg-white p-4">
              <QRCode
                value={formatDeviceLinkCode({
                  devicePublicKey: link.devicePublicKey,
                  linkId: link.linkId,
                  psk: link.psk,
                })}
                size={240}
              />
            </View>
            <Text
              accessibilityLiveRegion="polite"
              className="text-muted-foreground text-center text-base leading-6"
            >
              {status.isError
                ? "We can’t reach your server right now. We’ll keep trying."
                : "Waiting for your other phone. This screen moves on by itself once it’s approved."}
            </Text>
          </View>
        ) : (
          <LoadingIndicator />
        )}
      </ScrollView>
    </View>
  );
};

export default LinkWithOtherPhoneScreen;
