import { useMutation } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { cn } from "../../lib/cn.ts";
import {
  clearSavedMap,
  getMapCacheSizeMb,
  mapCacheSizesMb,
  setMapCacheSizeMb,
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
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          <BackButton />
          <Text className="text-foreground text-2xl font-bold">Map storage</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-8 px-6 py-6 pb-32"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-muted-foreground text-base leading-6">
          Parts of the map you’ve looked at are saved on this phone, so the map opens faster and
          still shows those areas without a connection. They are deleted when you sign out.
        </Text>

        <View className="gap-3">
          <View className="gap-1">
            <Text className="text-foreground text-xl font-semibold">Space for saved maps</Text>
            <Text className="text-muted-foreground text-sm">
              When it’s full, the areas you looked at longest ago are removed first.
            </Text>
          </View>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Space for saved maps"
            className="overflow-hidden rounded-3xl border border-border bg-card"
          >
            {mapCacheSizesMb.map((size, index) => {
              const selected = sizeMb === size;
              return (
                <Pressable
                  key={size}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: changeSize.isPending }}
                  disabled={changeSize.isPending}
                  className={cn(
                    "flex-row items-center justify-between px-5 py-4",
                    index < mapCacheSizesMb.length - 1 && "border-b border-border/50",
                  )}
                  onPress={() => {
                    setSizeMb(size);
                    changeSize.mutate(size);
                  }}
                >
                  <Text className="text-foreground text-base font-medium">
                    {size >= 1000 ? `${size / 1000} GB` : `${size} MB`}
                  </Text>
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
          {changeSize.isError ? (
            <Text accessibilityLiveRegion="polite" className="text-destructive text-sm">
              Couldn’t change the space for saved maps. Try again.
            </Text>
          ) : null}
        </View>

        <View className="gap-3">
          <Button
            variant="outline"
            loading={deleteSavedMap.isPending}
            onPress={() => deleteSavedMap.mutate()}
          >
            <Text>Delete saved maps</Text>
          </Button>
          {deleteSavedMap.isSuccess || deleteSavedMap.isError ? (
            <Text accessibilityLiveRegion="polite" className="text-muted-foreground text-sm">
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
