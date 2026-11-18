import { ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { HistoryShareChoices } from "../../components/HistoryShareChoices.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useHistoryShare } from "../../hooks/useHistoryShare.ts";

const LocationHistoryScreen = () => {
  const { change, query, saving, setting } = useHistoryShare();
  const overridden = setting?.groups.filter((group) => group.historyShare !== null).length ?? 0;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Location history" />

      {query.isPending ? (
        <LoadingIndicator />
      ) : !setting ? (
        <View className="flex-1 items-center justify-center gap-4 px-6">
          <Text className="text-tertiary text-center">
            We couldn’t load your history setting. Check your connection and try again.
          </Text>
          <Button variant="secondary" onPress={() => query.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-4 px-6 py-6 pb-32"
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-tertiary text-base leading-6">
            Choose how much of your location history your groups can play back in Timeline. They can
            always see where you are now while you’re sharing.
          </Text>
          <HistoryShareChoices
            value={setting.account}
            disabled={saving}
            onChange={(account) => {
              if (account) void change({ account });
            }}
          />
          <Text className="text-tertiary text-sm leading-5">
            Choosing less deletes your older history from the server straight away. Choosing more
            only applies from now on. You can choose differently for a group in that group’s
            settings.
            {overridden > 0
              ? overridden === 1
                ? " 1 group has its own setting."
                : ` ${overridden} groups have their own settings.`
              : ""}
          </Text>
        </ScrollView>
      )}
    </View>
  );
};

export default LocationHistoryScreen;
