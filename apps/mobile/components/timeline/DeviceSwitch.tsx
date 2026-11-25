import { View } from "react-native";
import { Button } from "../ui/Button.tsx";
import { Text } from "../ui/Text.tsx";

export const DeviceSwitch = ({
  current,
  deviceIds,
  names,
  onSwitch,
}: {
  current: string;
  deviceIds: readonly string[];
  names: ReadonlyArray<{ deviceId: string; name: string }>;
  onSwitch: (deviceId: string) => void;
}) => {
  const nameOf = (deviceId: string) =>
    names.find((device) => device.deviceId === deviceId)?.name ?? "Another device";
  const next = deviceIds[(deviceIds.indexOf(current) + 1) % deviceIds.length] ?? current;
  return (
    <View className="flex-row items-center justify-between gap-2">
      <Text className="shrink text-sm text-secondary" numberOfLines={1}>
        Showing {nameOf(current)}
      </Text>
      <Button size="sm" variant="ghost" onPress={() => onSwitch(next)}>
        <Text numberOfLines={1}>Switch to {nameOf(next)}</Text>
      </Button>
    </View>
  );
};
