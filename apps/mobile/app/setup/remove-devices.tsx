import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { CheckIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { Alert } from "../../lib/alert.ts";
import { trpc } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { deviceIcons } from "../../lib/deviceIcons.ts";

const RemoveOldDevicesScreen = () => {
  const queryClient = useQueryClient();
  const devices = useQuery(trpc.account.listDevices.queryOptions());
  const removeDevice = useMutation({
    ...trpc.account.removeDevice.mutationOptions(),
    networkMode: "always",
  });
  const otherDevices = devices.data?.filter((device) => !device.isCurrent) ?? [];
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (devices.data && otherDevices.length === 0) router.replace("/setup/name");
  }, [devices.data, otherDevices.length]);

  const ticked = selected ?? new Set(otherDevices.map(({ id }) => id));

  const toggle = (deviceId: string) => {
    const next = new Set(ticked);
    if (next.has(deviceId)) next.delete(deviceId);
    else next.add(deviceId);
    setSelected(next);
  };

  const removeTicked = async () => {
    setRemoving(true);
    const failed = [];
    for (const device of otherDevices.filter(({ id }) => ticked.has(id))) {
      const result = await tryCatch(removeDevice.mutateAsync({ deviceId: device.id }));
      if (result.error) failed.push(device.name);
    }
    await queryClient.invalidateQueries({ queryKey: trpc.account.listDevices.queryKey() });
    setRemoving(false);
    if (failed.length > 0) {
      Alert.alert(
        "Some devices weren’t removed",
        `${failed.join(", ")} couldn’t be removed. You can remove them later in Account → Devices.`,
      );
    }
    router.replace("/setup/name");
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-6 py-6 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-4">
          <Text className="text-foreground text-3xl font-bold">
            Remove devices you no longer have
          </Text>
          <Text className="text-muted-foreground text-base leading-6">
            Removed devices are signed out and won’t receive new locations. Untick any phone you
            still use.
          </Text>
        </View>
        {devices.isPending && <LoadingIndicator />}
        {otherDevices.length > 0 && (
          <View className="overflow-hidden rounded-3xl border border-border bg-card">
            {otherDevices.map((device, index) => {
              const checked = ticked.has(device.id);
              return (
                <Pressable
                  key={device.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  onPress={() => toggle(device.id)}
                  className={cn(
                    "flex-row items-center gap-4 px-5 py-4",
                    index < otherDevices.length - 1 && "border-b border-border/50",
                  )}
                >
                  <Icon as={deviceIcons[device.icon].icon} className="text-primary size-5" />
                  <View className="flex-1">
                    <Text className="text-foreground text-base font-medium">{device.name}</Text>
                    {device.model && (
                      <Text className="text-muted-foreground text-sm">{device.model}</Text>
                    )}
                  </View>
                  <View
                    className={cn(
                      "size-6 items-center justify-center rounded-md border",
                      checked ? "border-primary bg-primary" : "border-border",
                    )}
                  >
                    {checked && <Icon as={CheckIcon} className="text-primary-foreground size-4" />}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
        <Button
          variant="destructive"
          onPress={removeTicked}
          disabled={removing || ticked.size === 0}
        >
          <Text>{removing ? "Removing…" : "Remove ticked devices"}</Text>
        </Button>
        <Button variant="outline" onPress={() => router.replace("/setup/name")} disabled={removing}>
          <Text>Keep them all</Text>
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
};

export default RemoveOldDevicesScreen;
