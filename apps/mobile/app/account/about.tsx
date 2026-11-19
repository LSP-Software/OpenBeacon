import { useMutation, useQuery } from "@tanstack/react-query";
import { FileTextIcon, ScaleIcon, ShieldCheckIcon } from "lucide-react-native";
import { Platform, ScrollView, View } from "react-native";
import { SettingsContainer } from "../../components/containers/settingsContainer.tsx";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useMapVersion } from "../../hooks/useMapVersion.ts";
import { trpc } from "../../lib/api.ts";
import { Alert } from "../../lib/alert.ts";
import { cn } from "../../lib/cn.ts";
import { clearSavedMap, mapCacheLimitMb } from "../../lib/mapCache.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";
import { appVersion, maplibreVersion } from "../../lib/versions.ts";

const AboutScreen = () => {
  const server = useQuery(trpc.account.version.queryOptions());
  const serverName = useQuery(trpc.account.serverName.queryOptions());
  const mapVersion = useMapVersion();
  const mapNotLoaded = "Open the map to load it";
  const deleteSavedMap = useMutation({ mutationFn: clearSavedMap, networkMode: "always" });

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="About" />
      <ScrollView contentContainerClassName="gap-6 px-4 pb-10 pt-2">
        <SettingsContainer
          categories={[
            {
              settings: [
                {
                  label: "Privacy policy",
                  icon: ShieldCheckIcon,
                  href: "https://openbeacon.net/privacy",
                },
                {
                  label: "Terms of service",
                  icon: FileTextIcon,
                  href: "https://openbeacon.net/terms",
                },
              ],
            },
          ]}
        />
        <View className="gap-2">
          <Text variant="label">Versions</Text>
          <View className="overflow-hidden rounded-2xl border border-border bg-card">
            {[
              {
                label: "Server",
                value: serverName.data ?? (serverName.isPending ? "Loading…" : "Unavailable"),
              },
              { label: "OpenBeacon", value: appVersion },
              { label: "MapLibre React Native", value: maplibreVersion },
              {
                label: "Map in use",
                value: mapVersion
                  ? mapVersion.slot
                    ? `Map ${mapVersion.slot}`
                    : "Server default"
                  : mapNotLoaded,
              },
              {
                label: "Map date (Protomaps build)",
                value: mapVersion ? (mapVersion.date ?? "Unknown") : mapNotLoaded,
              },
              {
                label: "Server API",
                value: server.data ?? (server.isPending ? "Loading…" : "Unavailable"),
              },
              ...(Platform.OS === "android"
                ? [{ label: "Android", value: String(Platform.constants.Release) }]
                : []),
            ].map((row, index) => (
              <View
                key={row.label}
                accessible
                accessibilityLabel={`${row.label}: ${row.value}`}
                className={cn(
                  "min-h-12 flex-row items-center justify-between gap-4 px-4 py-3",
                  index > 0 && "border-t border-border/60",
                )}
              >
                <Text className="text-secondary">{row.label}</Text>
                <Text className="text-foreground shrink text-right font-medium">{row.value}</Text>
              </View>
            ))}
          </View>
        </View>
        <View className="gap-3">
          <Text variant="label">Saved maps</Text>
          <Text className="text-secondary text-sm">
            Parts of the map you’ve looked at are saved on this {thisDeviceNoun()}, up to{" "}
            {mapCacheLimitMb} MB, so the map opens faster and still shows those areas without a
            connection. When that space is full, the areas you looked at longest ago are removed
            first. Saved maps are deleted when you sign out or your server updates its map.
          </Text>
          <Button
            variant="secondary"
            loading={deleteSavedMap.isPending}
            onPress={() =>
              Alert.alert(
                "Delete saved maps?",
                "Until you’re back online, areas you’ve looked at will be blank.",
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => deleteSavedMap.mutate() },
                ],
              )
            }
          >
            <Text>Delete saved maps</Text>
          </Button>
          {deleteSavedMap.isSuccess ? (
            <Text accessibilityLiveRegion="polite" className="text-tertiary text-sm">
              Saved maps deleted. Areas you look at again will be downloaded.
            </Text>
          ) : null}
          {deleteSavedMap.isError ? (
            <Text accessibilityLiveRegion="polite" className="text-destructive-text text-sm">
              Couldn’t delete saved maps. Try again.
            </Text>
          ) : null}
        </View>
        <View className="gap-2">
          <Text variant="label">Licences and attribution</Text>
          <Text className="text-secondary text-sm">
            OpenBeacon is open source software. Map data © OpenStreetMap contributors, available
            under the Open Database Licence.
          </Text>
          <Text className="text-secondary text-sm">
            Map rendering uses MapLibre React Native (MIT). Map styles and bundled assets are from
            Protomaps. Bundled Noto fonts are © 2022 The Noto Project Authors and licensed under the
            SIL Open Font License 1.1. Bundled sprites include Mapzen artwork © 2017 Mapzen,
            licensed under MIT.
          </Text>
          <SettingsContainer
            categories={[
              {
                settings: [
                  {
                    label: "OpenBeacon licence",
                    icon: ScaleIcon,
                    href: "https://github.com/LSP-Software/OpenBeacon/blob/main/LICENSE.md",
                  },
                  {
                    label: "OpenStreetMap copyright and licence",
                    icon: ScaleIcon,
                    href: "https://www.openstreetmap.org/copyright",
                  },
                  {
                    label: "Map asset licences and sources",
                    icon: ScaleIcon,
                    href: "https://github.com/LSP-Software/OpenBeacon/tree/main/apps/mobile/assets/map",
                  },
                  {
                    label: "MapLibre React Native licence",
                    icon: ScaleIcon,
                    href: "https://github.com/maplibre/maplibre-react-native/blob/main/LICENSE.md",
                  },
                ],
              },
            ]}
          />
        </View>
      </ScrollView>
    </View>
  );
};

export default AboutScreen;
