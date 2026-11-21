import { useQuery } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { CheckIcon, KeyRoundIcon } from "lucide-react-native";
import { useCallback } from "react";
import { View } from "react-native";
import {
  OnboardingNote,
  OnboardingScreen,
  useAdvanceOnboardingOnce,
} from "../../components/onboarding/OnboardingScreen.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const RecoveryStepScreen = () => {
  const noun = thisDeviceNoun();
  const advance = useAdvanceOnboardingOnce();
  const status = useQuery(trpc.accountRecovery.status.queryOptions());
  const hasPhrase = Boolean(status.data?.recoveryKey);

  useFocusEffect(
    useCallback(() => {
      if (hasPhrase) advance("recovery");
    }, [hasPhrase, advance]),
  );

  return (
    <OnboardingScreen
      step="recovery"
      illustration={
        <View className="items-center py-6">
          <View className="size-20 items-center justify-center rounded-full bg-primary">
            <Icon as={KeyRoundIcon} className="size-9 text-white" />
          </View>
        </View>
      }
      title="Create recovery phrase"
      description={`Your history is encrypted with a key only your ${noun}s hold. If you lose this ${noun}, a 12-word recovery phrase is the only way to get it back. We can’t reset it for you.`}
      primary={{
        label: "Create my phrase",
        onPress: () => router.push("/account/recovery-setup"),
      }}
      secondary={{ label: "Skip for now", onPress: () => advance("recovery") }}
    >
      <View className="gap-3">
        {[
          "Takes about a minute",
          "Write it down, keep it in a password manager or save it as a PDF",
          `Also lets you set up a new ${noun} without your old one`,
        ].map((item) => (
          <View key={item} className="flex-row items-center gap-3">
            <Icon as={CheckIcon} className="text-primary size-5" />
            <Text className="text-foreground flex-1 text-sm">{item}</Text>
          </View>
        ))}
      </View>
      <OnboardingNote text="Not now? You can create one any time in Account → Recovery phrase." />
    </OnboardingScreen>
  );
};

export default RecoveryStepScreen;
