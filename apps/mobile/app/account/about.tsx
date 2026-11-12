import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useMapVersion } from "../../hooks/useMapVersion.ts";
import { trpc } from "../../lib/api.ts";
import { appVersion, maplibreVersion } from "../../lib/versions.ts";

const AboutScreen = () => {
  const server = useQuery(trpc.account.version.queryOptions());
  const serverName = useQuery(trpc.account.serverName.queryOptions());
  const mapVersion = useMapVersion();
  const mapNotLoaded = "Open the map to load it";

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          <BackButton />
          <Text className="text-foreground text-2xl font-bold">About</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>
      <ScrollView contentContainerClassName="gap-5 px-6 py-6">
        <Link href="https://openbeacon.net/privacy" className="text-primary-text">
          Privacy policy
        </Link>
        <Link href="https://openbeacon.net/terms" className="text-primary-text">
          Terms of service
        </Link>
        <Text>
          Server: {serverName.data ?? (serverName.isPending ? "Loading…" : "Unavailable")}
        </Text>
        <Text className="text-xl font-semibold">Versions</Text>
        <Text>OpenBeacon: {appVersion}</Text>
        <Text>MapLibre React Native: {maplibreVersion}</Text>
        <Text>
          Map in use:{" "}
          {mapVersion
            ? mapVersion.slot
              ? `Map ${mapVersion.slot}`
              : "Server default"
            : mapNotLoaded}
        </Text>
        <Text>
          Map date (Protomaps build): {mapVersion ? (mapVersion.date ?? "Unknown") : mapNotLoaded}
        </Text>
        <Text>Server API: {server.data ?? (server.isPending ? "Loading…" : "Unavailable")}</Text>
        {Platform.OS === "android" && <Text>Android: {Platform.constants.Release}</Text>}
        <Text className="text-xl font-semibold">Licences and attribution</Text>
        <Text>OpenBeacon is open source software.</Text>
        <Link
          href="https://github.com/LSP-Software/OpenBeacon/blob/main/LICENSE.md"
          className="text-primary-text"
        >
          OpenBeacon licence
        </Link>
        <Text>
          Map data © OpenStreetMap contributors, available under the Open Database Licence.
        </Text>
        <Link href="https://www.openstreetmap.org/copyright" className="text-primary-text">
          OpenStreetMap copyright and licence
        </Link>
        <Text>
          Map rendering uses MapLibre React Native (MIT). Map styles and bundled assets are from
          Protomaps. Bundled Noto fonts are © 2022 The Noto Project Authors and licensed under the
          SIL Open Font License 1.1. Bundled sprites include Mapzen artwork © 2017 Mapzen, licensed
          under MIT.
        </Text>
        <Link
          href="https://github.com/LSP-Software/OpenBeacon/tree/main/apps/mobile/assets/map"
          className="text-primary-text"
        >
          Map asset licences and sources
        </Link>
        <Link
          href="https://github.com/maplibre/maplibre-react-native/blob/main/LICENSE.md"
          className="text-primary-text"
        >
          MapLibre React Native licence
        </Link>
      </ScrollView>
    </View>
  );
};

export default AboutScreen;
