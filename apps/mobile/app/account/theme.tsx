import { MoonIcon, SmartphoneIcon, SunIcon } from "lucide-react-native";
import { ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { ChoiceList } from "../../components/ui/ChoiceList.tsx";
import type { ThemePreference } from "../../lib/themePreferences.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const themeOptions: { value: ThemePreference; title: string; icon: typeof SunIcon }[] = [
  { value: "system", title: `Match ${thisDeviceNoun()}`, icon: SmartphoneIcon },
  { value: "light", title: "Light", icon: SunIcon },
  { value: "dark", title: "Dark", icon: MoonIcon },
];

const ThemeScreen = () => {
  const { appThemePreference, mapThemePreference, setAppThemePreference, setMapThemePreference } =
    useTheme();

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Theme" />

      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-4 pb-10 pt-2"
        showsVerticalScrollIndicator={false}
      >
        <ChoiceList
          title="App"
          footer={`Match ${thisDeviceNoun()} follows your ${thisDeviceNoun()}’s light or dark setting.`}
          accessibilityLabel="App theme"
          options={themeOptions}
          selected={appThemePreference}
          onChange={setAppThemePreference}
        />
        <ChoiceList
          title="Map"
          footer="The map can use a different theme from the rest of the app."
          accessibilityLabel="Map theme"
          options={themeOptions}
          selected={mapThemePreference}
          onChange={setMapThemePreference}
        />
      </ScrollView>
    </View>
  );
};

export default ThemeScreen;
