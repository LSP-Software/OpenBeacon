import { ActivityIndicator, ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { HistoryShareChoices } from "../../components/HistoryShareChoices.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useHistoryExport } from "../../hooks/useHistoryExport.ts";
import { useHistoryShare } from "../../hooks/useHistoryShare.ts";
import { Alert } from "../../lib/alert.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const LocationHistoryScreen = () => {
  const { cancelExport, exportHistory, exporting } = useHistoryExport();
  const { change, query, saving, setting } = useHistoryShare(true, () =>
    Alert.alert(
      "Save a copy of your history",
      "Choose a format. Once it’s saved, change your setting again.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Save as GPX", onPress: () => void exportHistory("gpx") },
        { text: "Save as JSON", onPress: () => void exportHistory("json") },
      ],
    ),
  );
  const overridden = setting?.groups.filter((group) => group.historyShare !== null).length ?? 0;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Location history" />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-4 pb-32 pt-2"
        showsVerticalScrollIndicator={false}
      >
        {query.isPending ? (
          <ActivityIndicator size="large" className="text-primary py-8" />
        ) : !setting ? (
          <View className="items-center gap-4 py-8">
            <Text className="text-tertiary text-center">
              We couldn’t load your history setting. Check your connection and try again.
            </Text>
            <Button variant="secondary" onPress={() => query.refetch()}>
              <Text>Try again</Text>
            </Button>
          </View>
        ) : (
          <>
            <Text className="text-secondary text-base">
              Choose how much of your location history your groups can play back in Timeline. They
              can always see where you are now while you’re sharing.
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
          </>
        )}
        <View className="gap-3">
          <Text accessibilityRole="header" className="text-foreground text-lg font-semibold">
            Export your history
          </Text>
          <Text className="text-secondary text-base">
            Save a copy of your own location history from your groups. Your {thisDeviceNoun()}{" "}
            decrypts it and makes the file, so the server never sees what’s inside. The file itself
            isn’t encrypted, so keep it somewhere safe.
          </Text>
          <View className="flex-row gap-3">
            {(["gpx", "json"] as const).map((format) => (
              <Button
                key={format}
                variant="secondary"
                className="flex-1"
                disabled={exporting !== null}
                loading={exporting?.format === format}
                onPress={() => void exportHistory(format)}
              >
                <Text>{format === "gpx" ? "Save as GPX" : "Save as JSON"}</Text>
              </Button>
            ))}
          </View>
          {exporting ? (
            <>
              <Text accessibilityLiveRegion="polite" className="text-tertiary text-sm leading-5">
                {exporting.total > 0
                  ? `Decrypting your history… ${Math.round((exporting.done / exporting.total) * 100)}%. Stay on this screen until it’s done.`
                  : "Getting your history…"}
              </Text>
              <Button variant="ghost" className="self-start" onPress={cancelExport}>
                <Text>Cancel</Text>
              </Button>
            </>
          ) : (
            <Text className="text-tertiary text-sm leading-5">
              GPX opens in most map and fitness apps. JSON is for spreadsheets and your own tools,
              and also has accuracy, speed and battery.
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

export default LocationHistoryScreen;
