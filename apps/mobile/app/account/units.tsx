import { ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { ChoiceList } from "../../components/ui/ChoiceList.tsx";
import { useUnits } from "../../hooks/useUnits.ts";
import { unitsName } from "../../lib/units.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const UnitsScreen = () => {
  const { preference, regionUnit, setPreference } = useUnits();

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
          title="Distance and speed"
          footer={`Used for speeds and place sizes, and for distance travelled in Timeline. This setting stays on this ${thisDeviceNoun()}.`}
          accessibilityLabel="Distance and speed units"
          options={[
            {
              value: "auto",
              title: `Match this ${thisDeviceNoun()}’s region`,
              description: `Currently ${unitsName(regionUnit)}`,
            },
            { value: "mph", title: unitsName("mph") },
            { value: "kmh", title: unitsName("kmh") },
          ]}
          selected={preference}
          onChange={setPreference}
        />
      </ScrollView>
    </View>
  );
};

export default UnitsScreen;
