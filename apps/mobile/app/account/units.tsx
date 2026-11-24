import { ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { ChoiceList } from "../../components/ui/ChoiceList.tsx";
import { useUnits } from "../../hooks/useUnits.ts";
import { distanceUnitName, speedUnitName } from "../../lib/units.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const UnitsScreen = () => {
  const units = useUnits();
  const matchRegion = `Match this ${thisDeviceNoun()}’s region`;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Units" />

      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-4 pb-10 pt-2"
        showsVerticalScrollIndicator={false}
      >
        <ChoiceList
          title="Speed"
          footer="Used for how fast people are going on the map and in Timeline."
          accessibilityLabel="Speed units"
          options={[
            {
              value: "auto",
              title: matchRegion,
              description: `Currently ${speedUnitName(units.region.speed)}`,
            },
            { value: "mph", title: speedUnitName("mph") },
            { value: "kmh", title: speedUnitName("kmh") },
          ]}
          selected={units.speedPreference}
          onChange={units.setSpeedPreference}
        />
        <ChoiceList
          title="Distance"
          footer={`Used for place sizes and for distance travelled in Timeline. These settings stay on this ${thisDeviceNoun()}.`}
          accessibilityLabel="Distance units"
          options={[
            {
              value: "auto",
              title: matchRegion,
              description: `Currently ${distanceUnitName(units.region.distance)}`,
            },
            { value: "mi", title: distanceUnitName("mi") },
            { value: "km", title: distanceUnitName("km") },
          ]}
          selected={units.distancePreference}
          onChange={units.setDistancePreference}
        />
      </ScrollView>
    </View>
  );
};

export default UnitsScreen;
