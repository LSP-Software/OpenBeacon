import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { RecoveryCoverage } from "../../components/RecoveryCoverage.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { getStoredHistoryKey } from "../../lib/historyKeys.ts";

const RecoveryScreen = () => {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const status = useQuery(trpc.accountRecovery.status.queryOptions());
  const currentVersion = status.data?.currentHistoryKey?.version;
  const historyKeyHeld = useQuery({
    queryKey: ["historyKeyHeld", userId, currentVersion],
    enabled: Boolean(userId && currentVersion),
    queryFn: async () => {
      if (!userId || !currentVersion) return false;
      return (await getStoredHistoryKey({ userId, version: currentVersion })) !== null;
    },
  });

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          <BackButton />
          <Text className="text-foreground text-2xl font-bold">Recovery phrase</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-6 py-6 pb-32"
        showsVerticalScrollIndicator={false}
      >
        {status.isError && <Text>Unable to load your recovery settings. Please try again.</Text>}
        {status.data && !status.data.recoveryKey && (
          <View className="gap-4">
            <Text className="text-foreground text-3xl font-bold">Protect your history</Text>
            <Text className="text-muted-foreground text-base leading-6">
              A recovery phrase is 12 words that let you read your encrypted location history on a
              new phone. Only you have it: OpenBeacon can’t see it or reset it for you.
            </Text>
            <Text className="text-muted-foreground text-base leading-6">
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
        {status.data?.recoveryKey && historyKeyHeld.data === true && (
          <View className="gap-4">
            <Text className="text-foreground text-3xl font-bold">Your phrase is set up</Text>
            <Text className="text-muted-foreground text-base leading-6">
              Keep your recovery phrase somewhere safe. You’ll need it to read your history on a new
              phone.
            </Text>
            <RecoveryCoverage userId={userId} />
          </View>
        )}
        {status.data?.recoveryKey && historyKeyHeld.data === false && (
          <View className="gap-4">
            <Text className="text-foreground text-3xl font-bold">Restore your history</Text>
            <Text className="text-muted-foreground text-base leading-6">
              Your account already has a recovery phrase, set up on another phone. Enter it on this
              phone to read your history here.
            </Text>
            <Link href="/account/recovery-restore" asChild>
              <Button>
                <Text>Restore with recovery phrase</Text>
              </Button>
            </Link>
          </View>
        )}
        {historyKeyHeld.isError && (
          <Text>Unable to read this phone’s recovery keys. Unlock your phone and try again.</Text>
        )}
      </ScrollView>
    </View>
  );
};

export default RecoveryScreen;
