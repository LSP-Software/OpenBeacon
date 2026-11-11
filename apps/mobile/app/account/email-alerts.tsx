import { emailAlertSettingsSchema } from "@openbeacon/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { z } from "zod";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { Alert } from "../../lib/alert.ts";
import { trpc } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";

const alerts = [
  {
    label: "Password changed or reset",
    description: "Always on. Sent when your password is changed or reset.",
  },
  {
    label: "Recovery phrase changed or reset",
    description: "Always on. Sent when your recovery phrase is changed or reset.",
  },
  {
    label: "New sign-in",
    description: "When a new phone or tablet signs in to your account.",
    setting: "alertNewSignIn",
  },
  {
    label: "Account deletion scheduled",
    description: "When someone asks for your account to be deleted.",
    setting: "alertDeletionScheduled",
  },
] satisfies {
  label: string;
  description: string;
  setting?: keyof z.infer<typeof emailAlertSettingsSchema>;
}[];

const EmailAlertsScreen = () => {
  const queryClient = useQueryClient();
  const settings = useQuery(trpc.emailAlerts.settings.queryOptions());
  const settingsKey = trpc.emailAlerts.settings.queryKey();
  const updateSettings = useMutation(
    trpc.emailAlerts.updateSettings.mutationOptions({
      onMutate: (next) => {
        const previous = queryClient.getQueryData(settingsKey);
        queryClient.setQueryData(settingsKey, next);
        return { previous };
      },
      onSuccess: (data) => queryClient.setQueryData(settingsKey, data),
      onError: (error, _next, context) => {
        queryClient.setQueryData(settingsKey, context?.previous);
        Alert.alert("Unable to save your email alerts", error.message);
      },
    }),
  );

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          <BackButton />
          <Text className="text-foreground text-2xl font-bold">Email alerts</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-6 py-6 pb-32"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-2">
          <Text className="text-foreground text-3xl font-bold">Security emails</Text>
          <Text className="text-muted-foreground text-base leading-6">
            We email you when something important happens to your account. Emails never include your
            location.
          </Text>
        </View>

        {settings.isError && (
          <View className="gap-3">
            <Text>Unable to load your email alerts. Please try again.</Text>
            <Button variant="outline" onPress={() => settings.refetch()}>
              <Text>Try again</Text>
            </Button>
          </View>
        )}

        {settings.isPending && <LoadingIndicator />}

        {settings.data && (
          <View className="overflow-hidden rounded-3xl border border-border bg-card">
            {alerts.map((alert, index) => {
              const setting = "setting" in alert ? alert.setting : null;
              return (
                <View
                  key={alert.label}
                  className={cn(
                    "flex-row items-center gap-4 px-5 py-4",
                    index < alerts.length - 1 && "border-b border-border/50",
                  )}
                >
                  <View className="flex-1 gap-1">
                    <Text className="text-foreground text-base font-medium">{alert.label}</Text>
                    <Text className="text-muted-foreground text-sm">{alert.description}</Text>
                  </View>
                  {setting ? (
                    <Switch
                      accessibilityLabel={alert.label}
                      value={settings.data[setting]}
                      disabled={updateSettings.isPending}
                      onValueChange={(value) =>
                        updateSettings.mutate({ ...settings.data, [setting]: value })
                      }
                    />
                  ) : (
                    <Text className="text-muted-foreground text-sm">Always on</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

export default EmailAlertsScreen;
