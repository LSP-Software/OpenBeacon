import { BatteryMediumIcon } from "lucide-react-native";
import { Platform, ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { ListRow, ListSection } from "../../components/ui/List.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { setLowPowerMode, useLowPowerMode } from "../../lib/lowPowerMode.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const SaveBatteryScreen = () => {
  const enabled = useLowPowerMode();

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Save battery while moving" />

      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-4 pb-10 pt-2"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-secondary px-4 text-[15px] leading-5">
          While you’re moving, OpenBeacon sends your location more often the faster you go: about
          once a minute on foot, and as often as every 10 seconds in a car. This keeps your pin up
          to date and moving smoothly on other people’s maps, but uses more battery on long
          journeys.
        </Text>
        <ListSection
          footer={`When this is on, your location is sent about once a minute however fast you go. While you’re moving, others may see you up to a minute behind, and your pin moves across their maps in bigger steps. When ${Platform.OS === "ios" ? "Low Power Mode" : "Battery Saver"} is on, or your battery is at 15% or less and not charging, your location is sent every 2 minutes either way.`}
        >
          <ListRow
            title="Save battery while moving"
            icon={BatteryMediumIcon}
            iconColor="green"
            subtitle={
              enabled ? `On for this ${thisDeviceNoun()}.` : `Off for this ${thisDeviceNoun()}.`
            }
            accessibilityRole="switch"
            accessibilityState={{ checked: enabled }}
            onPress={() => void setLowPowerMode(!enabled)}
            trailing={
              <Switch
                accessibilityLabel="Save battery while moving"
                value={enabled}
                onValueChange={(next) => void setLowPowerMode(next)}
              />
            }
          />
        </ListSection>
      </ScrollView>
    </View>
  );
};

export default SaveBatteryScreen;
