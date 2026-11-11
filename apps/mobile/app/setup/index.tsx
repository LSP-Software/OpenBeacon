import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { type Href, Link, router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { RadioCardGroup } from "../../components/ui/RadioCardGroup.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { Alert } from "../../lib/alert.ts";
import { trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { isThisDeviceActive } from "../../lib/deviceActivation.ts";
import { clearPendingJoinCodes, openAppAfterSetup } from "../../lib/pendingJoinCode.ts";
import { signOutOfThisPhone } from "../../lib/signOut.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const SetUpPhoneScreen = () => {
  const { data: session } = authClient.useSession();
  const status = useQuery(trpc.accountRecovery.status.queryOptions());
  const deviceStatus = useQuery(trpc.device.status.queryOptions());
  const noOtherPhone = deviceStatus.data?.accountHasActiveDevice === false;
  const [cancelling, setCancelling] = useState(false);
  const cancellingRef = useRef(false);
  const refetchDeviceStatus = deviceStatus.refetch;
  const noun = thisDeviceNoun();
  const recoveryKey = !!status.data?.recoveryKey;
  const options: {
    id: "link" | "restore" | "waiting" | "reset";
    title: string;
    description: string;
    href: Href;
  }[] = [
    ...(noOtherPhone
      ? []
      : [
          {
            id: "link" as const,
            title: "Link with your other device",
            description: `Your other device scans a code on this ${noun}, and this ${noun} gets your full location history.`,
            href: "/setup/link" as const,
          },
        ]),
    ...(recoveryKey
      ? [
          {
            id: "restore" as const,
            title: "Enter your recovery phrase",
            description: `This ${noun} gets your full location history.`,
            href: { pathname: "/account/recovery-restore", params: { setup: "true" } } as const,
          },
        ]
      : []),
    ...(!recoveryKey && !noOtherPhone
      ? [
          {
            id: "waiting" as const,
            title: "Create a phrase on your other device",
            description:
              "Your account doesn’t have a recovery phrase yet. Create one on another device you still have, then enter it here.",
            href: "/setup/waiting" as const,
          },
        ]
      : []),
    {
      id: "reset",
      title: recoveryKey
        ? "I’ve lost my phrase"
        : noOtherPhone
          ? "Start fresh"
          : "I don’t have another device",
      description:
        "Set up a new recovery phrase. Your location history from before today will be lost.",
      href: { pathname: "/account/recovery-reset", params: { setup: "true" } },
    },
  ];
  const [choice, setChoice] = useState<(typeof options)[number]["id"] | null>(null);
  const selected = options.find((option) => option.id === choice) ?? options[0];

  useFocusEffect(
    useCallback(() => {
      void refetchDeviceStatus();
      void (async () => {
        const active = await tryCatch(isThisDeviceActive());
        if (active.data === true) openAppAfterSetup("/");
      })();
    }, [refetchDeviceStatus]),
  );

  const leaveSetup = async ({ removeThisPhone }: { removeThisPhone: boolean }) => {
    if (cancellingRef.current) return;
    cancellingRef.current = true;
    setCancelling(true);
    const result = await tryCatch(
      signOutOfThisPhone({
        onSigningOut: () => {},
        removeThisPhone,
        sessionTokenToRevoke: session?.session?.token ?? null,
      }),
    );
    cancellingRef.current = false;
    setCancelling(false);
    if (result.data?.status === "serverUnreachable") {
      Alert.alert(
        "Couldn’t reach the server",
        `This ${noun} may not have been removed. Try again, or sign out anyway. If you sign out, this ${noun} will be removed automatically within 7 days.`,
        [
          { text: "Back", style: "cancel" },
          { text: "Sign out anyway", onPress: () => leaveSetup({ removeThisPhone: false }) },
          { text: "Try again", onPress: () => leaveSetup({ removeThisPhone: true }) },
        ],
      );
      return;
    }
    clearPendingJoinCodes();
    router.replace("/");
    if (removeThisPhone && result.data?.status === "signedOut") {
      Alert.alert(
        "You’re signed out",
        `This ${noun} couldn’t be removed now; it will be removed automatically within 7 days.`,
      );
    }
  };

  const confirmCancel = () =>
    Alert.alert(
      "Cancel setup?",
      `This ${noun} will be removed from your account and signed out. You can sign in again later to set it up.`,
      [
        { text: "Keep setting up", style: "cancel" },
        {
          text: "Cancel and remove",
          style: "destructive",
          onPress: () => leaveSetup({ removeThisPhone: true }),
        },
      ],
    );

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-6 py-6 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-4">
          <Text className="text-foreground text-3xl font-bold">Set up this {noun}</Text>
          <Text className="text-muted-foreground text-base leading-6">
            You’re signed in, but this {noun} can’t see anyone’s location until it’s set up. That
            keeps your family’s locations safe if someone else learns your password.
          </Text>
        </View>

        {status.isPending && <LoadingIndicator />}
        {status.isError && (
          <View className="gap-4">
            <Text className="text-muted-foreground text-base leading-6">
              We couldn’t reach the server. Check your connection and try again.
            </Text>
            <Button variant="outline" onPress={() => status.refetch()}>
              <Text>Try again</Text>
            </Button>
          </View>
        )}

        {status.data && noOtherPhone && (
          <Text className="text-muted-foreground text-base leading-6">
            None of your other devices are signed in, so you’ll need your recovery phrase or to
            start fresh.
          </Text>
        )}

        {status.data && selected && (
          <View className="gap-4">
            <Text accessibilityRole="header" className="font-semibold">
              How do you want to set up this {noun}?
            </Text>
            <RadioCardGroup
              accessibilityLabel="Setup method"
              options={options.map((option) => ({ ...option, value: option.id }))}
              selected={selected.id}
              onChange={setChoice}
            />
            <Link href={selected.href} asChild>
              <Button disabled={cancelling}>
                <Text>Continue</Text>
              </Button>
            </Link>
          </View>
        )}

        <Button variant="outline" onPress={confirmCancel} disabled={cancelling}>
          <Text>{cancelling ? "Cancelling…" : `Cancel and remove this ${noun}`}</Text>
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
};

export default SetUpPhoneScreen;
