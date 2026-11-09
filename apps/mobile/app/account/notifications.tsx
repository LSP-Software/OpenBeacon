import { useQuery } from "@tanstack/react-query";
import { MailIcon } from "lucide-react-native";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsContainer } from "../../components/containers/settingsContainer.tsx";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { trpc } from "../../lib/api.ts";

const NotificationsScreen = () => {
  const { data: providers } = useQuery(trpc.auth.providers.queryOptions());

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
            Choose what OpenBeacon tells you about and how.
          </Text>
        </View>

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
