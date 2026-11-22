import { notificationTypes } from "@openbeacon/schemas";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOffIcon } from "lucide-react-native";
import { ScrollView, View } from "react-native";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { PromptCard } from "../../components/PromptCard.tsx";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { ListRow, ListSection } from "../../components/ui/List.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { Alert } from "../../lib/alert.ts";
import { trpc } from "../../lib/api.ts";
import { useNotificationSettings } from "../../lib/notifications.ts";
import { userMessage } from "../../lib/userMessage.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const sections = [
  { key: "places", title: "Places" },
  { key: "groups", title: "Groups" },
  { key: "security", title: "Security" },
] as const;

const descriptions: Partial<Record<keyof typeof notificationTypes, string>> = {
  PLACE_ALERTS:
    "When someone arrives at or leaves a place. You can still mute people at each place.",
  ROLE_CHANGED: "When someone becomes an owner, admin or member.",
  NEW_SIGN_IN: "When a new phone or tablet signs in to your account.",
};

const NotificationsScreen = () => {
  const queryClient = useQueryClient();
  const notifications = useNotificationSettings();
  const settings = useQuery(trpc.notificationSettings.get.queryOptions());
  const settingsKey = trpc.notificationSettings.get.queryKey();
  const mutationKey = trpc.notificationSettings.set.mutationKey();
  const setCell = (
    type: keyof typeof notificationTypes,
    channel: "email" | "phone",
    enabled: boolean,
  ) => {
    const current = queryClient.getQueryData(settingsKey);
    if (!current) return;
    queryClient.setQueryData(settingsKey, {
      ...current,
      settings: current.settings.map((setting) =>
        setting.type === type ? { ...setting, [channel]: enabled } : setting,
      ),
    });
  };
  const setSetting = useMutation({
    ...trpc.notificationSettings.set.mutationOptions({
      onMutate: async ({ type, channel, enabled }) => {
        await queryClient.cancelQueries({ queryKey: settingsKey });
        const previous = queryClient
          .getQueryData(settingsKey)
          ?.settings.find((setting) => setting.type === type)?.[channel];
        setCell(type, channel, enabled);
        return { previous };
      },
      onSuccess: (data) => {
        if (queryClient.isMutating({ mutationKey }) <= 1) {
          queryClient.setQueryData(settingsKey, data);
        }
      },
      onError: (error, { type, channel }, context) => {
        if (typeof context?.previous === "boolean") setCell(type, channel, context.previous);
        Alert.alert("Couldn’t save your notification settings", userMessage(error));
      },
    }),
    networkMode: "always",
  });
  const saving = useMutationState({
    filters: { mutationKey, status: "pending" },
    select: (mutation) => mutation.state.variables,
  });
  const isSaving = (type: keyof typeof notificationTypes, channel: "email" | "phone") =>
    saving.some(
      (change) =>
        typeof change === "object" &&
        change !== null &&
        "type" in change &&
        "channel" in change &&
        change.type === type &&
        change.channel === channel,
    );
  const showEmail = settings.data?.canSendEmail ?? false;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Notifications" />

      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-4 pb-10 pt-2"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-secondary px-4 text-[15px] leading-5">
          Choose what you hear about. These settings are the same on all your phones. Security
          notifications go to your other phones, not the one that made the change.
        </Text>

        {notifications.enabled === false && (
          <PromptCard
            icon={BellOffIcon}
            tone="warning"
            title="Notifications are off"
            description={`This ${thisDeviceNoun()} can’t show any of the notifications below, show that it’s sharing your location, or tell you if sharing stops.`}
          >
            <Button size="sm" onPress={notifications.turnOn} loading={notifications.turningOn}>
              <Text>Turn on notifications</Text>
            </Button>
          </PromptCard>
        )}

        {settings.isError && (
          <View className="gap-3">
            <Text>Unable to load your notification settings. Please try again.</Text>
            <Button variant="secondary" onPress={() => settings.refetch()}>
              <Text>Try again</Text>
            </Button>
          </View>
        )}

        {settings.isPending && <LoadingIndicator />}

        {settings.data &&
          sections.map((section) => {
            const rows = settings.data.settings.filter(
              ({ type }) =>
                Object.hasOwn(notificationTypes, type) &&
                notificationTypes[type].section === section.key,
            );
            const emailColumn = showEmail && rows.some(({ email }) => email !== null);
            return (
              <ListSection
                key={section.key}
                title={section.title}
                footer={
                  section.key === "security" && showEmail
                    ? "Turning any of these off sends an email to your account’s address."
                    : undefined
                }
              >
                {rows.map((row) => {
                  const { label } = notificationTypes[row.type];
                  const description = descriptions[row.type];
                  const change = (channel: "email" | "phone", enabled: boolean) =>
                    setSetting.mutate({ type: row.type, channel, enabled });
                  return (
                    <ListRow
                      key={row.type}
                      title={label}
                      subtitle={description}
                      trailing={
                        <View className="flex-row gap-3">
                          {emailColumn && row.email !== null && (
                            <View className="items-center gap-1">
                              {showEmail && (
                                <Text className="text-tertiary text-xs font-semibold">Email</Text>
                              )}
                              <Switch
                                accessibilityLabel={`${label}, email`}
                                value={row.email}
                                disabled={isSaving(row.type, "email")}
                                onValueChange={(enabled) => change("email", enabled)}
                              />
                            </View>
                          )}
                          <View className="items-center gap-1">
                            {showEmail && (
                              <Text className="text-tertiary text-xs font-semibold">Phone</Text>
                            )}
                            <Switch
                              accessibilityLabel={showEmail ? `${label}, phone` : label}
                              value={row.phone}
                              disabled={isSaving(row.type, "phone")}
                              onValueChange={(enabled) => change("phone", enabled)}
                            />
                          </View>
                        </View>
                      }
                    />
                  );
                })}
              </ListSection>
            );
          })}
      </ScrollView>
    </View>
  );
};

export default NotificationsScreen;
