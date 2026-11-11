import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { Button } from "../../components/ui/Button.tsx";
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

        {status.data && !noOtherPhone && (
          <View className="gap-4">
            <Text className="text-foreground text-xl font-semibold">
              Do you have another phone or tablet signed in?
            </Text>
            <Link href="/setup/link" asChild>
              <Button>
                <Text>Yes, link with your other device</Text>
              </Button>
            </Link>
            <Text className="text-muted-foreground text-base leading-6">
              Your other device scans a code on this {noun}, and this {noun} gets your full location
              history. If you don’t have it with you:
            </Text>
          </View>
        )}

        {status.data?.recoveryKey && (
          <View className="gap-4">
            <Text className="text-muted-foreground text-base leading-6">
              Enter your recovery phrase. This {noun} then gets your full location history.
            </Text>
            <Link
              href={{ pathname: "/account/recovery-restore", params: { setup: "true" } }}
              asChild
            >
              <Button variant="outline">
                <Text>Enter your recovery phrase</Text>
              </Button>
            </Link>
            <Link href={{ pathname: "/account/recovery-reset", params: { setup: "true" } }} asChild>
              <Button variant="ghost">
                <Text>I’ve lost my phrase</Text>
              </Button>
            </Link>
          </View>
        )}

        {status.data && !status.data.recoveryKey && noOtherPhone && (
          <Link href={{ pathname: "/account/recovery-reset", params: { setup: "true" } }} asChild>
            <Button variant="outline">
              <Text>Start fresh</Text>
            </Button>
          </Link>
        )}

        {status.data && !status.data.recoveryKey && !noOtherPhone && (
          <View className="gap-4">
            <Text className="text-muted-foreground text-base leading-6">
              Your account doesn’t have a recovery phrase yet. Create one on another device you
              still have, then enter it here.
            </Text>
            <Link href="/setup/waiting" asChild>
              <Button variant="outline">
                <Text>Create a phrase on your other device</Text>
              </Button>
            </Link>
            <Link href={{ pathname: "/account/recovery-reset", params: { setup: "true" } }} asChild>
              <Button variant="ghost">
                <Text>I don’t have another device</Text>
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
