import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { ChoiceList } from "../../components/ui/ChoiceList.tsx";
import { Text } from "../../components/ui/Text.tsx";
import {
  clearSavedMap,
  getMapCacheSizeMb,
  mapCacheSizesMb,
  setMapCacheSizeMb,
  formatMapCacheSize,
} from "../../lib/mapCache.ts";

const MapStorageScreen = () => {
  const [sizeMb, setSizeMb] = useState(getMapCacheSizeMb);
  const changeSize = useMutation({
    mutationFn: setMapCacheSizeMb,
    networkMode: "always",
    onError: () => setSizeMb(getMapCacheSizeMb()),
  });
  const deleteSavedMap = useMutation({ mutationFn: clearSavedMap, networkMode: "always" });

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Map storage" />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-4 pb-32 pt-2"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-secondary text-base">
          Parts of the map you’ve looked at are saved on this phone, so the map opens faster and
          still shows those areas without a connection. They are deleted when you sign out.
        </Text>

        <View className="gap-2">
          <Text variant="label">Space for saved maps</Text>
          <ChoiceList
            accessibilityLabel="Space for saved maps"
            options={mapCacheSizesMb.map((size) => ({
              value: size,
              title: formatMapCacheSize(size),
            }))}
            selected={sizeMb}
            disabled={changeSize.isPending}
            onChange={(size) => {
              setSizeMb(size);
              changeSize.mutate(size);
            }}
          />
          <Text className="text-tertiary text-sm">
            When it’s full, the areas you looked at longest ago are removed first.
          </Text>
          {changeSize.isError ? (
            <Text accessibilityLiveRegion="polite" className="text-destructive-text text-sm">
              Couldn’t change the space for saved maps. Try again.
            </Text>
          ) : null}
        </View>

        <View className="gap-3">
          <Button
            variant="secondary"
            loading={deleteSavedMap.isPending}
            onPress={() => deleteSavedMap.mutate()}
          >
            <Text>Delete saved maps</Text>
          </Button>
          {deleteSavedMap.isSuccess || deleteSavedMap.isError ? (
            <Text accessibilityLiveRegion="polite" className="text-tertiary text-sm">
              {deleteSavedMap.isSuccess
                ? "Saved maps deleted. Areas you look at again will be downloaded."
                : "Couldn’t delete saved maps. Try again."}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
};

export default MapStorageScreen;
