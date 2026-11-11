import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { isThisDeviceActive } from "../../lib/deviceActivation.ts";
import { signOutOfThisPhone } from "../../lib/signOut.ts";

const SetUpPhoneScreen = () => {
  const { data: session } = authClient.useSession();
  const status = useQuery(trpc.accountRecovery.status.queryOptions());
  const deviceStatus = useQuery(trpc.device.status.queryOptions());
  const noOtherPhone = deviceStatus.data?.accountHasActiveDevice === false;
  const [signingOut, setSigningOut] = useState(false);
  const refetchDeviceStatus = deviceStatus.refetch;

  useFocusEffect(
    useCallback(() => {
      void refetchDeviceStatus();
      void (async () => {
        const active = await tryCatch(isThisDeviceActive());
        if (active.data === true) router.replace("/");
      })();
    }, [refetchDeviceStatus]),
  );

  const signOut = async () => {
    setSigningOut(true);
    await tryCatch(
      signOutOfThisPhone({
        onSigningOut: () => {},
        removeThisPhone: false,
        sessionTokenToRevoke: session?.session?.token ?? null,
      }),
    );
    setSigningOut(false);
    router.replace("/");
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-6 py-6 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-4">
          <Text className="text-foreground text-3xl font-bold">Set up this phone</Text>
          <Text className="text-muted-foreground text-base leading-6">
            You’re signed in, but this phone can’t see anyone’s location until it’s set up. That
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
            None of your other phones are signed in, so you’ll need your recovery phrase or to start
            fresh.
          </Text>
        )}

        {status.data && !noOtherPhone && (
          <View className="gap-4">
            <Text className="text-foreground text-xl font-semibold">
              Do you have another phone signed in?
            </Text>
            <Link href="/setup/link" asChild>
              <Button>
                <Text>Yes, link with your other phone</Text>
              </Button>
            </Link>
            <Text className="text-muted-foreground text-base leading-6">
              Your other phone scans a code on this one, and this phone gets your full location
              history. If you don’t have it with you:
            </Text>
          </View>
        )}

        {status.data?.recoveryKey && (
          <View className="gap-4">
            <Text className="text-muted-foreground text-base leading-6">
              Enter your recovery phrase. This phone then gets your full location history.
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
              Your account doesn’t have a recovery phrase yet. Create one on a phone you still have,
              then enter it here.
            </Text>
            <Link href="/setup/waiting" asChild>
              <Button variant="outline">
                <Text>Create a phrase on your other phone</Text>
              </Button>
            </Link>
            <Link href={{ pathname: "/account/recovery-reset", params: { setup: "true" } }} asChild>
              <Button variant="ghost">
                <Text>I don’t have another phone</Text>
              </Button>
            </Link>
          </View>
        )}

        <Button variant="outline" onPress={signOut} disabled={signingOut}>
          <Text>{signingOut ? "Signing out…" : "Sign out"}</Text>
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
};

export default SetUpPhoneScreen;
