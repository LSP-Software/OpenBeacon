import { Link } from "expo-router";
import { BellRingIcon, CirclePauseIcon, LockIcon, UsersIcon } from "lucide-react-native";
import { View } from "react-native";
import {
  OnboardingPoint,
  OnboardingScreen,
  useAdvanceOnboardingOnce,
} from "../../components/onboarding/OnboardingScreen.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const HowSharingWorksScreen = () => {
  const noun = thisDeviceNoun();
  const advance = useAdvanceOnboardingOnce();

  return (
    <OnboardingScreen
      step="sharing"
      title="You’re in control of your location"
      description="Before we ask for anything, here’s how sharing works."
      primary={{ label: "Sounds good", onPress: () => advance("sharing") }}
    >
      <View className="gap-3">
        <OnboardingPoint
          icon={UsersIcon}
          title="Only the groups you join"
          description="Nobody sees you until you create or join a group with them."
        />
        <OnboardingPoint
          icon={BellRingIcon}
          title={`This ${noun} always shows it’s sharing`}
          description="A notice stays on while your location is shared. No one can hide it from another phone."
        />
        <OnboardingPoint
          icon={CirclePauseIcon}
          title="Pause or leave any time"
          description="Nobody else can stop you pausing, leaving a group or deleting your account."
        />
        <OnboardingPoint
          icon={LockIcon}
          title={`Encrypted on your ${noun}`}
          description="Your location and battery level are encrypted before they leave. Our server stores them but can’t read them."
        />
      </View>
      <Link
        href="https://openbeacon.net/privacy"
        accessibilityRole="link"
        accessibilityLabel="What can the server see?"
        className="self-center py-2"
      >
        <Text className="text-primary-text text-base font-medium">What can the server see?</Text>
      </Link>
    </OnboardingScreen>
  );
};

export default HowSharingWorksScreen;
