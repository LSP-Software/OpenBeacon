import { router } from "expo-router";
import { LockIcon, ShieldCheckIcon } from "lucide-react-native";
import { useEffect, useEffectEvent, useState } from "react";
import { View } from "react-native";
import { BeaconIcon } from "../../components/BeaconIcon.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import {
  OnboardingPoint,
  OnboardingScreen,
} from "../../components/onboarding/OnboardingScreen.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { authClient } from "../../lib/auth-client.ts";
import { readThisDeviceState } from "../../lib/deviceActivation.ts";
import {
  advanceOnboarding,
  continueOnboarding,
  planCurrentOnboarding,
  readCurrentOnboarding,
} from "../../lib/onboarding.ts";
import type { OnboardingProgress } from "../../lib/onboardingTypes.ts";
import { useColors } from "../../lib/theme.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const begin = (progress: OnboardingProgress) => {
  if (progress.kind === "newDevice" && readThisDeviceState() === "active") {
    advanceOnboarding("restore");
    return;
  }
  continueOnboarding(progress);
};

const WelcomeScreen = () => {
  const { data: session } = authClient.useSession();
  const colors = useColors();
  const noun = thisDeviceNoun();
  const [progress] = useState(readCurrentOnboarding);
  const [starting, setStarting] = useState(false);
  const resumes = !progress || progress.steps !== null || progress.kind === "returning";

  const start = async () => {
    setStarting(true);
    const planned = await planCurrentOnboarding();
    if (!planned) {
      router.replace("/");
      return;
    }
    begin(planned);
  };

  const startEvent = useEffectEvent(start);

  useEffect(() => {
    if (resumes) void startEvent();
  }, [resumes]);

  if (resumes || !progress) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <LoadingIndicator />
      </View>
    );
  }

  const firstName = session?.user.name.split(" ")[0];

  if (progress.kind === "newDevice") {
    return (
      <OnboardingScreen
        illustration={
          <View className="items-center py-10">
            <BeaconIcon size={112} color={colors.primary} />
          </View>
        }
        title={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        description={`You’re signed in on a new ${noun}. Let’s connect it to your account so you can see your people again.`}
        primary={{ label: `Set up this ${noun}`, onPress: start, loading: starting }}
      >
        <OnboardingPoint
          icon={ShieldCheckIcon}
          title="Why there’s an extra step"
          description="A password alone can’t unlock anyone’s location. This keeps your family safe if someone else learns it."
        />
      </OnboardingScreen>
    );
  }

  return (
    <OnboardingScreen
      illustration={
        <View className="items-center py-10">
          <BeaconIcon size={112} color={colors.primary} />
        </View>
      }
      title="Welcome to OpenBeacon"
      description={`Let’s get this ${noun} ready to share with the people you choose. It takes about two minutes.`}
      primary={{ label: "Get started", onPress: start, loading: starting }}
    >
      <View className="rounded-3xl border border-border bg-card px-4">
        {[
          `Name this ${noun}`,
          "Choose what OpenBeacon can use",
          "Protect your location history",
        ].map((item, index, items) => (
          <View
            key={item}
            className={`flex-row items-center gap-4 py-3 ${index < items.length - 1 ? "border-b border-border/50" : ""}`}
          >
            <View className="size-8 items-center justify-center rounded-full bg-primary/10">
              <Text className="text-primary-text text-sm font-bold">{index + 1}</Text>
            </View>
            <Text className="text-foreground text-base font-medium">{item}</Text>
          </View>
        ))}
      </View>
      <View className="flex-row items-center justify-center gap-2">
        <Icon as={LockIcon} className="text-tertiary size-4" />
        <Text className="text-tertiary text-sm">Your location is end-to-end encrypted.</Text>
      </View>
    </OnboardingScreen>
  );
};

export default WelcomeScreen;
