import { tryCatch } from "@openbeacon/shared";
import { useState } from "react";
import { View } from "react-native";
import { BeaconIcon } from "../../components/BeaconIcon.tsx";
import {
  OnboardingNote,
  OnboardingScreen,
  useAdvanceOnboardingOnce,
} from "../../components/onboarding/OnboardingScreen.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useAppForeground } from "../../hooks/useAppForeground.ts";
import {
  areNotificationsEnabled,
  requestNotificationPermissions,
  turnOnNotifications,
} from "../../lib/notifications.ts";
import { useColors } from "../../lib/theme.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const ExampleNotification = ({ title, body }: { title: string; body?: string }) => {
  const colors = useColors();
  return (
    <View className="flex-row gap-3 rounded-2xl border border-border bg-card p-3">
      <View className="size-9 items-center justify-center rounded-lg bg-primary-soft">
        <BeaconIcon size={24} color={colors.primary} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-tertiary text-xs">OpenBeacon</Text>
        <Text className="text-foreground text-sm font-semibold">{title}</Text>
        {body && <Text className="text-tertiary text-sm">{body}</Text>}
      </View>
    </View>
  );
};

const NotificationsStepScreen = () => {
  const noun = thisDeviceNoun();
  const advance = useAdvanceOnboardingOnce();
  const [asking, setAsking] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const advanceIfTurnedOn = async () => {
    const enabled = await tryCatch(areNotificationsEnabled());
    if (enabled.data) advance("notifications");
  };

  useAppForeground(() => {
    if (blocked) void advanceIfTurnedOn();
  });

  const turnOn = async () => {
    setAsking(true);
    const permission = await tryCatch(requestNotificationPermissions());
    if (permission.data !== "blocked") {
      setAsking(false);
      advance("notifications");
      return;
    }
    setBlocked(true);
    await tryCatch(turnOnNotifications());
    setAsking(false);
  };

  return (
    <OnboardingScreen
      step="notifications"
      illustration={
        <View
          className="gap-2 py-4"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <ExampleNotification
            title="Sharing your location"
            body="Your groups can see where you are."
          />
          <ExampleNotification title="Emma arrived at School" />
        </View>
      }
      title="Turn on notifications"
      description={`So this ${noun} can show that it’s sharing, warn you if sharing stops, and tell you when people arrive at places you care about.`}
      primary={{
        label: blocked ? "Open Settings" : "Turn on notifications",
        onPress: turnOn,
        loading: asking,
      }}
      secondary={{ label: "Not now", onPress: () => advance("notifications") }}
    >
      <OnboardingNote
        text={
          blocked
            ? "Notifications are off for OpenBeacon. Turn them on in Settings, then come back and we’ll carry on."
            : `Your ${noun} will ask next. You can choose which alerts you get later in Account → Notifications.`
        }
      />
    </OnboardingScreen>
  );
};

export default NotificationsStepScreen;
