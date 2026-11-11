import { createDeviceLinkSecret, formatDeviceLinkCode } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { router } from "expo-router";
import {
  allowScreenCaptureAsync,
  disableAppSwitcherProtectionAsync,
  enableAppSwitcherProtectionAsync,
  preventScreenCaptureAsync,
} from "expo-screen-capture";
import { ArrowLeftIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";
import { KEY_NOT_SAVED_MESSAGE } from "../../lib/createHistoryKey.ts";
import { isThisDeviceActive } from "../../lib/deviceActivation.ts";
import { ensureDeviceKeyRegistration } from "../../lib/deviceKeys.ts";
import { finishDeviceLink, HANDOVER_REJECTED_MESSAGE } from "../../lib/deviceLink.ts";
import { resealPersonalData } from "../../lib/resealPersonalData.ts";
import {
  deleteSavedDeviceLink,
  readSavedDeviceLink,
  saveDeviceLink,
} from "../../lib/savedDeviceLink.ts";
import { requestTrackingSync } from "../../lib/trackingEvents.ts";

const UNREACHABLE_MESSAGE = "We couldn’t reach your server. Check your connection and try again.";

type Handover = Omit<Parameters<typeof finishDeviceLink>[0], "linkId" | "psk">;

const LinkWithOtherPhoneScreen = () => {
  const queryClient = useQueryClient();
  const createLink = useMutation(trpc.deviceLink.create.mutationOptions());
  const [link, setLink] = useState<{
    active: boolean;
    deviceId: string;
    devicePublicKey: string;
    linkId: string;
    psk: Uint8Array;
    userId: string;
  } | null>(null);
  const [handover, setHandover] = useState<Handover | null>(null);
  const [problem, setProblem] = useState<{
    message: string;
    action: "start" | "newCode" | "finish" | "continue" | "home";
  } | null>(null);
  const forgottenLinkId = useRef<string | null>(null);
  const status = useQuery({
    ...trpc.deviceLink.status.queryOptions({ linkId: link?.linkId ?? "" }),
    enabled: link !== null && handover === null && problem === null,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "approved" || state === "expired" ? false : 2_000;
    },
  });

  const showNewCode = async () => {
    setProblem(null);
    setLink(null);
    setHandover(null);
    const created = await tryCatch(
      Promise.all([ensureDeviceKeyRegistration(), createLink.mutateAsync()]),
    );
    if (created.error instanceof TRPCClientError && created.error.data?.code === "CONFLICT") {
      setProblem({ message: "This phone is already set up.", action: "home" });
      return;
    }
    if (created.error) {
      setProblem({ message: UNREACHABLE_MESSAGE, action: "newCode" });
      return;
    }
    const [device, { linkId }] = created.data;
    const psk = createDeviceLinkSecret();
    const saved = await tryCatch(
      saveDeviceLink({ deviceId: device.deviceId, linkId, psk, userId: device.userId }),
    );
    if (saved.error) {
      setProblem({ message: KEY_NOT_SAVED_MESSAGE, action: "newCode" });
      return;
    }
    setLink({
      active: false,
      deviceId: device.deviceId,
      devicePublicKey: device.publicKey,
      linkId,
      psk,
      userId: device.userId,
    });
  };

  const start = async () => {
    setProblem(null);
    const device = await tryCatch(ensureDeviceKeyRegistration());
    if (device.error) {
      setProblem({ message: UNREACHABLE_MESSAGE, action: "start" });
      return;
    }
    const saved = await tryCatch(readSavedDeviceLink(device.data));
    if (!saved.data) {
      await showNewCode();
      return;
    }
    const active = await tryCatch(isThisDeviceActive());
    setLink({
      active: active.data === true,
      deviceId: device.data.deviceId,
      devicePublicKey: device.data.publicKey,
      linkId: saved.data.linkId,
      psk: saved.data.psk,
      userId: device.data.userId,
    });
  };

  const finish = async (approved: Handover, current: { linkId: string; psk: Uint8Array }) => {
    setProblem(null);
    const finished = await tryCatch(
      finishDeviceLink({ ...approved, linkId: current.linkId, psk: current.psk }),
    );
    if (finished.error) {
      if (finished.error.message === HANDOVER_REJECTED_MESSAGE) {
        setProblem({ message: HANDOVER_REJECTED_MESSAGE, action: "continue" });
        return;
      }
      setProblem({
        message:
          finished.error instanceof TRPCClientError && !finished.error.data
            ? UNREACHABLE_MESSAGE
            : finished.error.message,
        action: "finish",
      });
      return;
    }
    await queryClient.invalidateQueries();
    requestTrackingSync();
    await tryCatch(resealPersonalData(finished.data.userId));
    router.replace("/setup/name");
  };

  useEffect(() => {
    void start();
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
    if (!link || data?.state !== "approved" || handover) return;
    const approved = {
      approverPublicKey: data.approverPublicKey,
      ciphertext: data.ciphertext,
      enc: data.enc,
    };
    setHandover(approved);
    void finish(approved, link);
  }, [link, handover, status.data]);

  useEffect(() => {
    if (!link || handover || forgottenLinkId.current === link.linkId) return;
    const state = status.data?.state;
    const gone = status.error instanceof TRPCClientError && status.error.data?.code === "NOT_FOUND";
    if (!gone && state !== "expired" && !(link.active && state === "waiting")) return;
    forgottenLinkId.current = link.linkId;
    void (async () => {
      await tryCatch(deleteSavedDeviceLink(link));
      if (link.active) {
        router.replace("/");
        return;
      }
      if (gone) await showNewCode();
    })();
  }, [link, handover, status.data, status.error]);

  const expired = status.data?.state === "expired";

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          {handover && !problem ? (
            <View className="w-10" />
          ) : (
            <Pressable
              className="flex flex-row items-center gap-1"
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/setup"))}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Icon as={ArrowLeftIcon} className="text-primary" />
              <Text className="text-primary">Back</Text>
            </Pressable>
          )}
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
            <Text className="text-destructive text-base leading-6">{problem.message}</Text>
            {problem.action === "continue" && (
              <Button onPress={() => router.replace("/setup/name")}>
                <Text>Continue</Text>
              </Button>
            )}
            {problem.action === "home" && (
              <Button onPress={() => router.replace("/")}>
                <Text>Continue</Text>
              </Button>
            )}
            {problem.action === "finish" && (
              <Button
                onPress={() => {
                  if (handover && link) void finish(handover, link);
                }}
              >
                <Text>Try again</Text>
              </Button>
            )}
            {problem.action === "start" && (
              <Button onPress={start}>
                <Text>Try again</Text>
              </Button>
            )}
            {problem.action === "newCode" && (
              <Button onPress={showNewCode}>
                <Text>Try again</Text>
              </Button>
            )}
          </View>
        ) : handover ? (
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
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel="Setup code. Scan it with your other phone."
              className="rounded-3xl bg-white p-4"
            >
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
                : "Waiting for your other phone. This screen moves on by itself once you tap Add on it."}
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
