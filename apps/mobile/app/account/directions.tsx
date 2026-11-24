import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useMMKVString } from "react-native-mmkv";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { ChoiceList } from "../../components/ui/ChoiceList.tsx";
import {
  type DirectionsApp,
  directionsAppKey,
  installedDirectionsApps,
  parseDirectionsApp,
} from "../../lib/directions.ts";
import { storage } from "../../lib/storage.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const DirectionsScreen = () => {
  const [stored, setStored] = useMMKVString(directionsAppKey, storage);
  const [installed, setInstalled] = useState<{ app: DirectionsApp; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    void installedDirectionsApps().then((apps) => {
      if (!cancelled) setInstalled(apps);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saved = parseDirectionsApp(stored);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Directions" />

      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-4 pb-10 pt-2"
        showsVerticalScrollIndicator={false}
      >
        <ChoiceList<DirectionsApp | "ask">
          title="Open directions in"
          footer={`Directions to someone on the map open in this app. It gets their location but not their name. This setting stays on this ${thisDeviceNoun()}.`}
          accessibilityLabel="Directions app"
          options={[
            {
              value: "ask",
              title: "Ask me",
              description: "Choose an app the next time you get directions.",
            },
            ...installed.map((option) => ({ value: option.app, title: option.name })),
          ]}
          selected={saved && installed.some((option) => option.app === saved) ? saved : "ask"}
          onChange={(value) => setStored(value === "ask" ? undefined : value)}
        />
      </ScrollView>
    </View>
  );
};

export default DirectionsScreen;
