import { CheckIcon, MoonIcon, SmartphoneIcon, SunIcon } from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { cn } from "../../lib/cn.ts";
import type { ThemePreference } from "../../lib/themePreferences.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";

const themeOptions = [
  {
    value: "system",
    label: "Use system",
    description: "Follow your device appearance automatically.",
    icon: SmartphoneIcon,
  },
  {
    value: "light",
    label: "Light",
    description: "Keep this surface bright all the time.",
    icon: SunIcon,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Use the darker palette regardless of device setting.",
    icon: MoonIcon,
  },
] satisfies {
  value: ThemePreference;
  label: string;
  description: string;
  icon: typeof SmartphoneIcon;
}[];

const ThemePreferenceSection = ({
  title,
  description,
  themePreference,
  onChange,
}: {
  title: string;
  description: string;
  themePreference: ThemePreference;
  onChange: (themePreference: ThemePreference) => void;
}) => {
  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text className="text-foreground text-xl font-semibold">{title}</Text>
        <Text className="text-muted-foreground text-sm">{description}</Text>
      </View>
      <View
        accessibilityRole="radiogroup"
        className="overflow-hidden rounded-3xl border border-border bg-card"
      >
        {themeOptions.map((themeOption, index) => {
          const selected = themePreference === themeOption.value;
          const isLastOption = index === themeOptions.length - 1;

          return (
            <Pressable
              key={themeOption.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              className={cn(
                "flex-row items-center gap-4 px-5 py-4",
                !isLastOption && "border-b border-border/50",
              )}
              onPress={() => onChange(themeOption.value)}
            >
              <View
                className={cn(
                  "size-11 items-center justify-center rounded-2xl border",
                  selected ? "border-primary bg-primary/10" : "border-border bg-background/70",
                )}
              >
                <Icon
                  as={themeOption.icon}
                  className={selected ? "text-primary size-5" : "text-muted-foreground size-5"}
                />
              </View>
              <View className="flex-1 gap-1">
                <Text className="text-foreground text-base font-medium">{themeOption.label}</Text>
                <Text className="text-muted-foreground text-sm">{themeOption.description}</Text>
              </View>
              <View
                className={cn(
                  "size-6 items-center justify-center rounded-full border",
                  selected ? "border-primary bg-primary" : "border-border bg-background",
                )}
              >
                {selected ? (
                  <Icon as={CheckIcon} className="size-4 text-primary-foreground" />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const ThemeScreen = () => {
  const { appThemePreference, mapThemePreference, setAppThemePreference, setMapThemePreference } =
    useTheme();

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          <BackButton />
          <Text className="text-foreground text-2xl font-bold">Theme</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-8 px-6 py-6 pb-32"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-2">
          <Text className="text-foreground text-3xl font-bold">Appearance</Text>
          <Text className="text-muted-foreground text-base leading-6">
            Choose how OpenBeacon looks, and whether the map should match or use its own palette.
          </Text>
        </View>

        <ThemePreferenceSection
          title="App theme"
          description="Controls the overall interface, including pages, dialogs, and navigation."
          themePreference={appThemePreference}
          onChange={setAppThemePreference}
        />

        <ThemePreferenceSection
          title="Map theme"
          description="Changes the map palette separately from the rest of the app."
          themePreference={mapThemePreference}
          onChange={setMapThemePreference}
        />
      </ScrollView>
    </View>
  );
};

export default ThemeScreen;
