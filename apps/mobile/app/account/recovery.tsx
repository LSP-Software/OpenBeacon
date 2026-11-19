import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { RecoveryCoverage } from "../../components/RecoveryCoverage.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useHeldHistoryKeyVersions } from "../../hooks/useHeldHistoryKeyVersions.ts";
import { trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const RecoveryScreen = () => {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const status = useQuery(trpc.accountRecovery.status.queryOptions());
  const currentVersion = status.data?.currentHistoryKey?.version;
  const heldVersions = useHeldHistoryKeyVersions(
    userId,
    status.data?.currentHistoryKey ?? undefined,
  );
  const holdsCurrent = currentVersion !== undefined && heldVersions.data?.includes(currentVersion);
  const holdsEveryVersion = status.data?.historyKeyVersions.every((version) =>
    heldVersions.data?.includes(version),
  );

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Recovery phrase" />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-4 pb-32 pt-2"
        showsVerticalScrollIndicator={false}
      >
        {(status.isPending || heldVersions.isLoading) && <LoadingIndicator />}
        {status.isError && (
          <View className="gap-4">
            <Text>Unable to load your recovery settings. Please try again.</Text>
            <Button variant="secondary" onPress={() => status.refetch()}>
              <Text>Try again</Text>
            </Button>
          </View>
        )}
        {status.data && !status.data.recoveryKey && (
          <View className="gap-4">
            <Text className="text-foreground text-2xl font-bold">Protect your history</Text>
            <Text className="text-secondary text-base">
              A recovery phrase is 12 words that let you read your encrypted location history on a
              new phone. Only you have it. OpenBeacon never sees it and can’t give it back to you.
            </Text>
            <Text className="text-secondary text-base">
              Without a phrase, losing every phone you’re signed in on means losing your location
              history.
            </Text>
            <Link href="/account/recovery-setup" asChild>
              <Button>
                <Text>Create recovery phrase</Text>
              </Button>
            </Link>
          </View>
        )}
        {status.data?.recoveryKey && heldVersions.data && holdsCurrent && (
          <View className="gap-4">
            <Text className="text-foreground text-2xl font-bold">Your phrase is set up</Text>
            <Text className="text-secondary text-base">
              Keep your recovery phrase somewhere safe. You’ll need it to read your history on a new
              phone.
            </Text>
            <RecoveryCoverage userId={userId} />
            {holdsEveryVersion ? (
              <View className="gap-2">
                <Link href="/account/recovery-change" asChild>
                  <Button variant="secondary">
                    <Text>Change recovery phrase</Text>
                  </Button>
                </Link>
                <Text className="text-tertiary text-sm leading-5">
                  If you’ve lost your phrase or think someone else has seen it, create a new one.
                  Your old phrase will stop working.
                </Text>
              </View>
            ) : (
              <View className="gap-2">
                <Text className="text-tertiary text-sm leading-5">
                  To change your phrase, this {thisDeviceNoun()} first needs your current recovery
                  phrase. Restore it, then try again.
                </Text>
                <Link href="/account/recovery-restore" asChild>
                  <Button variant="secondary">
                    <Text>Restore with recovery phrase</Text>
                  </Button>
                </Link>
              </View>
            )}
          </View>
        )}
        {status.data?.recoveryKey && heldVersions.data && !holdsCurrent && (
          <View className="gap-4">
            <Text className="text-foreground text-2xl font-bold">Restore your history</Text>
            <Text className="text-secondary text-base">
              {heldVersions.data.length > 0
                ? "Your recovery phrase was reset on another phone. Enter the new phrase to keep reading new history here."
                : `Your account already has a recovery phrase, set up on another phone. Enter it on this ${thisDeviceNoun()} to read your history here.`}
            </Text>
            <Link href="/account/recovery-restore" asChild>
              <Button>
                <Text>Restore with recovery phrase</Text>
              </Button>
            </Link>
            <Link href="/account/recovery-reset" asChild>
              <Button variant="ghost">
                <Text>I’ve lost my phrase</Text>
              </Button>
            </Link>
          </View>
        )}
        {heldVersions.isError && (
          <View className="gap-4">
            <Text>
              Unable to read this {thisDeviceNoun()}’s recovery keys. Unlock your {thisDeviceNoun()}{" "}
              and try again.
            </Text>
            <Button variant="secondary" onPress={() => heldVersions.refetch()}>
              <Text>Try again</Text>
            </Button>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

export default RecoveryScreen;
