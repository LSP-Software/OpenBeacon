import { notificationTypes } from "@openbeacon/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOffIcon } from "lucide-react-native";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { PromptCard } from "../../components/PromptCard.tsx";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { Alert } from "../../lib/alert.ts";
import { trpc } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { useNotificationSettings } from "../../lib/notifications.ts";

const sections = [
  { key: "places", title: "Places" },
  { key: "groups", title: "Groups" },
  { key: "security", title: "Security" },
] as const;

const descriptions: Partial<Record<keyof typeof notificationTypes, string>> = {
  PLACE_ALERTS:
    "When someone arrives at or leaves a place. You can still mute people at each place.",
  ROLE_CHANGED: "When someone becomes an owner, admin or member.",
  NEW_SIGN_IN: "A new phone or tablet signs in to your account.",
};

const NotificationsScreen = () => {
  const queryClient = useQueryClient();
  const notifications = useNotificationSettings();
  const settings = useQuery(trpc.notificationSettings.get.queryOptions());
  const settingsKey = trpc.notificationSettings.get.queryKey();
  const setSetting = useMutation(
    trpc.notificationSettings.set.mutationOptions({
      onMutate: ({ type, channel, enabled }) => {
        const previous = queryClient.getQueryData(settingsKey);
        if (previous) {
          queryClient.setQueryData(settingsKey, {
            ...previous,
            settings: previous.settings.map((setting) =>
              setting.type === type ? { ...setting, [channel]: enabled } : setting,
            ),
          });
        }
        return { previous };
      },
      onSuccess: (data) => queryClient.setQueryData(settingsKey, data),
      onError: (error, _change, context) => {
        queryClient.setQueryData(settingsKey, context?.previous);
        Alert.alert("Unable to save your notification settings", error.message);
      },
    }),
  );
  const showEmail = settings.data?.canSendEmail ?? false;

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
            Choose what you hear about. These settings are the same on all your phones. Security
            notifications go to your other phones, not the one that made the change.
          </Text>
        </View>

        {notifications.enabled === false && (
          <PromptCard
            icon={BellOffIcon}
            tone="warning"
            title="Notifications are off"
            description="This phone can’t show that it’s sharing your location, or tell you if sharing stops."
          >
            <Button size="sm" onPress={notifications.turnOn} loading={notifications.turningOn}>
              <Text>Turn on notifications</Text>
            </Button>
          </PromptCard>
        )}

        {settings.isError && (
          <View className="gap-3">
            <Text>Unable to load your notification settings. Please try again.</Text>
            <Button variant="outline" onPress={() => settings.refetch()}>
              <Text>Try again</Text>
            </Button>
          </View>
        )}

        {settings.isPending && <LoadingIndicator />}

        {settings.data &&
          sections.map((section) => {
            const rows = settings.data.settings.filter(
              ({ type }) => notificationTypes[type].section === section.key,
            );
            const emailColumn = showEmail && rows.some(({ email }) => email !== null);
            return (
              <View key={section.key} className="gap-2">
                <Text className="text-muted-foreground px-1 text-sm font-semibold uppercase tracking-wider">
                  {section.title}
                </Text>
                <View className="overflow-hidden rounded-3xl border border-border bg-card">
                  {showEmail && (
                    <View className="flex-row justify-end gap-4 px-5 pt-3">
                      {emailColumn && (
                        <Text className="text-muted-foreground w-12 text-center text-xs font-semibold">
                          Email
                        </Text>
                      )}
                      <Text className="text-muted-foreground w-12 text-center text-xs font-semibold">
                        Phone
                      </Text>
                    </View>
                  )}
                  {rows.map((row, index) => {
                    const { label } = notificationTypes[row.type];
                    const description = descriptions[row.type];
                    const change = (channel: "email" | "phone", enabled: boolean) =>
                      setSetting.mutate({ type: row.type, channel, enabled });
                    return (
                      <View
                        key={row.type}
                        className={cn(
                          "flex-row items-center gap-4 px-5 py-4",
                          index > 0 && "border-t border-border/50",
                        )}
                      >
                        <View className="flex-1 gap-1">
                          <Text className="text-foreground text-base font-medium">{label}</Text>
                          {description && (
                            <Text className="text-muted-foreground text-sm">{description}</Text>
                          )}
                        </View>
                        {emailColumn && row.email !== null && (
                          <View className="w-12 items-center">
                            <Switch
                              accessibilityLabel={`${label}, email`}
                              value={row.email}
                              disabled={setSetting.isPending}
                              onValueChange={(enabled) => change("email", enabled)}
                            />
                          </View>
                        )}
                        <View className="w-12 items-center">
                          <Switch
                            accessibilityLabel={showEmail ? `${label}, phone notifications` : label}
                            value={row.phone}
                            disabled={setSetting.isPending}
                            onValueChange={(enabled) => change("phone", enabled)}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}

        {showEmail && (
          <Text className="text-muted-foreground px-1 text-sm">
            Turning off a security notification sends an email to your account’s address to say so.
          </Text>
        )}
      </ScrollView>
    </View>
  );
};

export default NotificationsScreen;
