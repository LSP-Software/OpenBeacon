import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { BellOffIcon, MailIcon } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { AppState, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsContainer } from "../../components/containers/settingsContainer.tsx";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import {
  areNotificationsEnabled,
  requestNotificationPermissions,
} from "../../lib/notifications.ts";

const phoneNotices = [
  {
    label: "Sharing stopped",
    description:
      "If location access is turned off, or this phone is removed from your account or signed out.",
  },
  {
    label: "Update needed",
    description: "If the app or your server needs updating before sharing can carry on.",
  },
  {
    label: "Sharing changed from another device",
    description:
      "If you pause or resume sharing elsewhere and this phone needs opening to catch up.",
  },
  {
    label: "Sharing status",
    description: "Shown while this phone is sharing its location or sharing is paused.",
  },
];

const NotificationsScreen = () => {
  const { data: providers } = useQuery(trpc.auth.providers.queryOptions());
  const [enabled, setEnabled] = useState<boolean | null>(null);

  const refreshPermission = useCallback(async () => {
    const result = await tryCatch(areNotificationsEnabled());
    if (!result.error) setEnabled(result.data);
  }, []);

  useEffect(() => {
    void refreshPermission();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshPermission();
    });
    return () => subscription.remove();
  }, [refreshPermission]);

  const turnOn = async () => {
    const result = await tryCatch(requestNotificationPermissions());
    if (result.data === "blocked") await Linking.openSettings();
    await refreshPermission();
  };

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          <BackButton />
          <Text className="text-foreground text-2xl font-bold">Notifications</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-6 py-6 pb-32"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-2">
          <Text className="text-foreground text-3xl font-bold">Notifications</Text>
          <Text className="text-muted-foreground text-base leading-6">
            Open Beacon only notifies you when something needs your attention. Notifications never
            include anyone's location.
          </Text>
        </View>

        {Platform.OS === "android" && (
          <View className="gap-3">
            <Text className="text-lg font-medium text-muted-foreground">On this phone</Text>

            {enabled === false && (
              <View className="gap-4 rounded-3xl border border-border bg-card p-5">
                <View className="flex-row items-start gap-3">
                  <View className="size-10 items-center justify-center rounded-full bg-warning-accent/15">
                    <Icon as={BellOffIcon} className="size-5 text-warning-accent" />
                  </View>
                  <View className="flex-1 gap-1">
                    <Text className="text-foreground text-base font-semibold">
                      Notifications are off
                    </Text>
                    <Text className="text-muted-foreground text-sm">
                      You won't be told if this phone stops sharing your location.
                    </Text>
                  </View>
                </View>
                <Button onPress={turnOn}>
                  <Text>Turn on notifications</Text>
                </Button>
              </View>
            )}

            <View className="overflow-hidden rounded-3xl border border-border bg-card">
              {phoneNotices.map((notice, index) => (
                <View
                  key={notice.label}
                  className={cn(
                    "gap-1 px-5 py-4",
                    index < phoneNotices.length - 1 && "border-b border-border/50",
                  )}
                >
                  <Text className="text-foreground text-base font-medium">{notice.label}</Text>
                  <Text className="text-muted-foreground text-sm">{notice.description}</Text>
                </View>
              ))}
            </View>

            {enabled && (
              <Button variant="outline" onPress={() => void Linking.openSettings()}>
                <Text>Manage in Android settings</Text>
              </Button>
            )}
          </View>
        )}

        {providers?.email ? (
          <SettingsContainer
            categories={[
              {
                label: "Email",
                settings: [
                  { label: "Email alerts", icon: MailIcon, href: "/account/email-alerts" },
                ],
              },
            ]}
          />
        ) : null}
      </ScrollView>
    </View>
  );
};

export default NotificationsScreen;
