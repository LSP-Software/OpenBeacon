import { ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { ChoiceList } from "../../components/ui/ChoiceList.tsx";
import { useSpeedUnit } from "../../hooks/useSpeedUnit.ts";
import { speedUnitName } from "../../lib/speed.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const UnitsScreen = () => {
  const { preference, regionUnit, setPreference } = useSpeedUnit();

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
          footer={`Used for how fast people are going on the map and in Timeline. This setting stays on this ${thisDeviceNoun()}.`}
          accessibilityLabel="Speed units"
          options={[
            {
              value: "auto",
              title: `Match this ${thisDeviceNoun()}’s region`,
              description: `Currently ${speedUnitName(regionUnit)}`,
            },
            { value: "mph", title: speedUnitName("mph") },
            { value: "kmh", title: speedUnitName("kmh") },
          ]}
          selected={preference}
          onChange={setPreference}
        />
      </ScrollView>
    </View>
  );
};

export default UnitsScreen;
