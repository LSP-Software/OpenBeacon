import { useMutation, useQuery } from "@tanstack/react-query";
import { FileTextIcon, ScaleIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react-native";
import { Platform, ScrollView, View } from "react-native";
import { SettingsContainer } from "../../components/containers/settingsContainer.tsx";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { ListRow, ListSection } from "../../components/ui/List.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useMapVersion } from "../../hooks/useMapVersion.ts";
import { trpc } from "../../lib/api.ts";
import { Alert } from "../../lib/alert.ts";
import { clearSavedMap, mapCacheLimitMb } from "../../lib/mapCache.ts";
import {
  deleteSpeedLimitData,
  readSpeedLimitDataSize,
  speedLimitPackBudgetMb,
} from "../../lib/speedLimitPacks.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";
import { timeSince } from "../../lib/timeSince.ts";
import { getPushStatus } from "../../lib/tracking.ts";
import { appVersion, maplibreVersion } from "../../lib/versions.ts";

const InfoRows = ({
  title,
  footer,
  rows,
}: {
  title: string;
  footer?: string;
  rows: { label: string; value: string }[];
}) => (
  <ListSection title={title} footer={footer}>
    {rows.map((row) => (
      <ListRow
        key={row.label}
        title={row.label}
        value={row.value}
        accessibilityLabel={`${row.label}: ${row.value}`}
      />
    ))}
  </ListSection>
);

const AboutScreen = () => {
  const server = useQuery(trpc.account.version.queryOptions());
  const push = useQuery({
    queryKey: ["pushStatus"],
    queryFn: getPushStatus,
    enabled: Platform.OS === "android",
    refetchInterval: 5_000,
    gcTime: 0,
    retry: false,
    networkMode: "always",
  });
  const pushStatus = push.data;
  const serverName = useQuery(trpc.account.serverName.queryOptions());
  const mapVersion = useMapVersion();
  const mapNotLoaded = "Open the map to load it";
  const deleteSavedMap = useMutation({ mutationFn: clearSavedMap, networkMode: "always" });
  const speedLimitSize = useQuery({
    queryKey: ["speedLimitDataSize"],
    queryFn: readSpeedLimitDataSize,
    enabled: Platform.OS === "android",
    gcTime: 0,
    networkMode: "always",
  });
  const deleteSpeedLimits = useMutation({
    mutationFn: deleteSpeedLimitData,
    onSettled: () => speedLimitSize.refetch(),
    networkMode: "always",
  });

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="About" />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-4 pb-10 pt-2"
      >
        <SettingsContainer
          categories={[
            {
              settings: [
                {
                  label: "Privacy policy",
                  icon: ShieldCheckIcon,
                  color: "green",
                  href: "https://openbeacon.net/privacy",
                },
                {
                  label: "Terms of service",
                  icon: FileTextIcon,
                  color: "gray",
                  href: "https://openbeacon.net/terms",
                },
              ],
            },
          ]}
        />
        <InfoRows
          title="Versions"
          rows={[
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
          ]}
        />
        {push.isError ? (
          <InfoRows
            title="Push wake-ups"
            rows={[{ label: "Status", value: "Couldn’t read push status" }]}
          />
        ) : pushStatus ? (
          <InfoRows
            title="Push wake-ups"
            footer={`When something happens in your groups, such as a place alert or an Update now request, your server can ask Google’s Firebase to wake this ${thisDeviceNoun()} so it checks in within seconds. Self-hosted servers don’t send wake-ups, so this ${thisDeviceNoun()} picks up news the next time it checks in.`}
            rows={[
              {
                label: "Your server",
                value:
                  pushStatus.serverPush === null
                    ? "Not checked yet"
                    : pushStatus.serverPush
                      ? "Sends wake-ups"
                      : "Doesn’t send wake-ups",
              },
              {
                label: "This app",
                value: pushStatus.builtIn ? "Built with wake-ups" : "Built without wake-ups",
              },
              ...(pushStatus.serverPush && pushStatus.builtIn
                ? [
                    {
                      label: "Push token",
                      value: {
                        noToken: "Not received from Google yet",
                        notSent: "Not sent to your server yet",
                        registered: "Sent to your server",
                      }[pushStatus.registration],
                    },
                  ]
                : []),
              {
                label: "Last wake-up",
                value: pushStatus.lastWakeAt
                  ? `${timeSince(pushStatus.lastWakeAt, push.dataUpdatedAt)} (${pushStatus.lastWakeKind === "locate" ? "Update now" : "new activity"})`
                  : "None yet",
              },
            ]}
          />
        ) : null}
        <View className="gap-2">
          <ListSection
            title="Saved maps"
            footer={`Parts of the map you’ve looked at are saved on this ${thisDeviceNoun()}, up to ${mapCacheLimitMb} MB, so the map opens faster and still shows those areas without a connection. When that space is full, the areas you looked at longest ago are removed first. Saved maps are deleted when you sign out or your server updates its map.`}
          >
            <ListRow
              title={deleteSavedMap.isPending ? "Deleting saved maps…" : "Delete saved maps"}
              icon={Trash2Icon}
              tone="danger"
              disabled={deleteSavedMap.isPending}
              onPress={() =>
                Alert.alert(
                  "Delete saved maps?",
                  "Until you’re back online, areas you’ve looked at will be blank.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => deleteSavedMap.mutate(),
                    },
                  ],
                )
              }
            />
          </ListSection>
          {deleteSavedMap.isSuccess ? (
            <Text accessibilityLiveRegion="polite" className="text-tertiary px-4 text-sm">
              Saved maps deleted. Areas you look at again will be downloaded.
            </Text>
          ) : null}
          {deleteSavedMap.isError ? (
            <Text accessibilityLiveRegion="polite" className="text-destructive-text px-4 text-sm">
              Couldn’t delete saved maps. Try again.
            </Text>
          ) : null}
        </View>
        {Platform.OS === "android" ? (
          <View className="gap-2">
            <ListSection
              title="Speed limit data"
              footer={`Speed limits for the region this ${thisDeviceNoun()} is in are downloaded on Wi-Fi while Drive detection is on, up to ${speedLimitPackBudgetMb} MB, so drives can be checked for speeding here. When that space is full, the region you were in longest ago is removed first. Speed limit data is deleted when you sign out or turn Drive detection off. Speed limits © OpenStreetMap contributors, available under the Open Database Licence.`}
            >
              <ListRow
                title="Speed limit data"
                value={
                  speedLimitSize.data === undefined
                    ? "…"
                    : speedLimitSize.data === 0
                      ? "None"
                      : `${Math.max(1, Math.round(speedLimitSize.data / 1_000_000))} MB`
                }
              />
              <ListRow
                title={
                  deleteSpeedLimits.isPending
                    ? "Deleting speed limit data…"
                    : "Delete speed limit data"
                }
                icon={Trash2Icon}
                tone="danger"
                disabled={deleteSpeedLimits.isPending || !speedLimitSize.data}
                onPress={() =>
                  Alert.alert(
                    "Delete speed limit data?",
                    "Until it downloads again on Wi-Fi, drives won’t be checked for speeding.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => deleteSpeedLimits.mutate(),
                      },
                    ],
                  )
                }
              />
            </ListSection>
            {deleteSpeedLimits.isError ? (
              <Text accessibilityLiveRegion="polite" className="text-destructive-text px-4 text-sm">
                Couldn’t delete speed limit data. Try again.
              </Text>
            ) : null}
          </View>
        ) : null}
        <SettingsContainer
          categories={[
            {
              label: "Licences and attribution",
              footer:
                "OpenBeacon is open source software. Map and speed limit data © OpenStreetMap contributors, available under the Open Database Licence. Map rendering uses MapLibre React Native (MIT). Map styles and bundled assets are from Protomaps. Bundled Noto fonts are © 2022 The Noto Project Authors and licensed under the SIL Open Font License 1.1. Bundled sprites include Mapzen artwork © 2017 Mapzen, licensed under MIT.",
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
      </ScrollView>
    </View>
  );
};

export default AboutScreen;
