import { useQuery } from "@tanstack/react-query";
import { Link, router } from "expo-router";
import { useEffect } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";

const WaitingForPhraseScreen = () => {
  const status = useQuery({
    ...trpc.accountRecovery.status.queryOptions(),
    refetchInterval: 5_000,
  });
  const phraseReady = Boolean(status.data?.recoveryKey);

  useEffect(() => {
    if (phraseReady) {
      router.replace({ pathname: "/account/recovery-restore", params: { setup: "true" } });
    }
  }, [phraseReady]);

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
        <Text className="text-foreground text-3xl font-bold">
          Create a phrase on your other phone
        </Text>
        <View className="gap-3">
          {[
            "Open OpenBeacon on your other phone.",
            "Go to Account → Recovery phrase and tap Create recovery phrase.",
            "Write down the 12 words and keep them somewhere safe.",
          ].map((step, index) => (
            <View key={step} className="flex-row gap-3">
              <Text className="text-primary text-base font-bold">{index + 1}.</Text>
              <Text className="text-foreground flex-1 text-base leading-6">{step}</Text>
            </View>
          ))}
        </View>
        <Text
          accessibilityLiveRegion="polite"
          className="text-muted-foreground text-base leading-6"
        >
          {status.isError
            ? "We can’t reach the server right now. We’ll keep trying."
            : "Waiting for your phrase. This phone moves on as soon as it’s ready."}
        </Text>
        <Link href={{ pathname: "/account/recovery-reset", params: { setup: "true" } }} asChild>
          <Button variant="ghost">
            <Text>I can’t get to my other phone</Text>
          </Button>
        </Link>
      </ScrollView>
    </View>
  );
};

export default WaitingForPhraseScreen;
