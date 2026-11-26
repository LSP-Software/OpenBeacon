import { NavigationIcon } from "lucide-react-native";
import { Alert } from "../../lib/alert.ts";
import {
  type DirectionsApp,
  directionsAppKey,
  directionsAppName,
  installedDirectionsApps,
  openDirections,
  parseDirectionsApp,
} from "../../lib/directions.ts";
import { storage } from "../../lib/storage.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";

export const DirectionsButton = ({
  destination,
  name,
  outOfDateAge,
  size,
}: {
  destination: { latitude: number; longitude: number };
  name: string;
  outOfDateAge: string | null;
  size?: "tile";
}) => {
  const open = async (app: DirectionsApp) => {
    if (await openDirections(app, destination)) return;
    if (storage.getString(directionsAppKey) === app) storage.remove(directionsAppKey);
    Alert.alert(
      `Couldn’t open ${directionsAppName(app)}`,
      "Check it’s still installed, then try again.",
    );
  };

  const chooseAndOpen = async () => {
    const installed = await installedDirectionsApps();
    const saved = parseDirectionsApp(storage.getString(directionsAppKey));
    const savedApp = installed.find((option) => option.app === saved);
    if (savedApp) {
      await open(savedApp.app);
      return;
    }
    if (saved) storage.remove(directionsAppKey);
    const [onlyApp] = installed;
    if (installed.length === 1 && onlyApp) {
      await open(onlyApp.app);
      return;
    }
    if (installed.length === 0) {
      Alert.alert("No maps app found", "Install a maps app to get directions.");
      return;
    }
    Alert.alert(
      "Get directions with",
      "OpenBeacon will remember this. You can change it in Account under Directions.",
      [
        { text: "Cancel", style: "cancel" as const },
        ...installed
          .map((option) => ({
            text: option.name,
            onPress: () => {
              storage.set(directionsAppKey, option.app);
              void open(option.app);
            },
          }))
          .reverse(),
      ],
    );
  };

  return (
    <Button
      variant="secondary"
      size={size}
      className={size === "tile" ? "" : "mt-4"}
      accessibilityLabel={`Directions to ${name}`}
      accessibilityHint="Opens your maps app"
      onPress={() => {
        if (outOfDateAge === null) {
          void chooseAndOpen();
          return;
        }
        Alert.alert(
          `${name}’s location is out of date`,
          `Directions will go to where ${name} was ${outOfDateAge}.`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Get directions", onPress: () => void chooseAndOpen() },
          ],
        );
      }}
    >
      <Icon as={NavigationIcon} size={18} className="text-foreground" />
      <Text maxFontSizeMultiplier={size === "tile" ? 1.3 : undefined}>Directions</Text>
    </Button>
  );
};
