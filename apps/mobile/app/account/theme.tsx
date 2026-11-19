import { MoonIcon, SmartphoneIcon, SunIcon } from "lucide-react-native";
import { ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { ChoiceList } from "../../components/ui/ChoiceList.tsx";
import { Text } from "../../components/ui/Text.tsx";
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
        contentContainerClassName="gap-6 px-4 pb-32 pt-2"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-2">
          <Text variant="label">App</Text>
          <ChoiceList
            accessibilityLabel="App theme"
            options={themeOptions}
            selected={appThemePreference}
            onChange={setAppThemePreference}
          />
          <Text className="text-tertiary px-1 text-sm">
            Match {thisDeviceNoun()} follows your {thisDeviceNoun()}’s light or dark setting.
          </Text>
        </View>

        <View className="gap-2">
          <Text variant="label">Map</Text>
          <ChoiceList
            accessibilityLabel="Map theme"
            options={themeOptions}
            selected={mapThemePreference}
            onChange={setMapThemePreference}
          />
          <Text className="text-tertiary px-1 text-sm">
            The map can use a different theme from the rest of the app.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

export default ThemeScreen;
