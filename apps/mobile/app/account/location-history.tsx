import { ActivityIndicator, ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { HistoryShareChoices } from "../../components/HistoryShareChoices.tsx";
import { BracesIcon, MapIcon } from "lucide-react-native";
import { Button } from "../../components/ui/Button.tsx";
import { ListRow, ListSection } from "../../components/ui/List.tsx";
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
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-4 pb-10 pt-2"
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
            <Text className="text-secondary px-4 text-[15px] leading-5">
              Choose how much of your location history your groups can play back in Timeline. They
              can always see where you are now while you’re sharing.
            </Text>
            <HistoryShareChoices
              title="Share with your groups"
              footer={`Choosing less deletes your older history from the server straight away. Choosing more only applies from now on. You can choose differently for a group in that group’s settings.${
                overridden > 0
                  ? overridden === 1
                    ? " 1 group has its own setting."
                    : ` ${overridden} groups have their own settings.`
                  : ""
              }`}
              value={setting.account}
              disabled={saving}
              onChange={(account) => {
                if (account) void change({ account });
              }}
            />
          </>
        )}
        <ListSection
          title="Export your history"
          footer={
            exporting
              ? exporting.total > 0
                ? `Decrypting your history… ${Math.round((exporting.done / exporting.total) * 100)}%. Stay on this screen until it’s done.`
                : "Getting your history…"
              : `Save a copy of your own location history from your groups. Your ${thisDeviceNoun()} decrypts it and makes the file, so the server never sees what’s inside. The file itself isn’t encrypted, so keep it somewhere safe. GPX opens in most map and fitness apps. JSON is for spreadsheets and your own tools, and also has accuracy, speed and battery.`
          }
        >
          {(["gpx", "json"] as const).map((format) => (
            <ListRow
              key={format}
              title={
                exporting?.format === format
                  ? "Saving…"
                  : format === "gpx"
                    ? "Save as GPX"
                    : "Save as JSON"
              }
              icon={format === "gpx" ? MapIcon : BracesIcon}
              iconColor={format === "gpx" ? "green" : "blue"}
              disabled={exporting !== null}
              onPress={() => void exportHistory(format)}
            />
          ))}
          {exporting ? <ListRow title="Cancel" tone="action" onPress={cancelExport} /> : null}
        </ListSection>
      </ScrollView>
    </View>
  );
};

export default LocationHistoryScreen;
