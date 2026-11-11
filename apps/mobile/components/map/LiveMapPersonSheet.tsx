import { Link } from "expo-router";
import { Pressable, View } from "react-native";
import { useTimeSince } from "../../hooks/useTimeSince.ts";
import { getBatteryVisual } from "../../lib/batteryVisual.ts";
import { type DeviceIcon, deviceIconFor } from "../../lib/deviceIcons.ts";
import { locationStaleAt } from "../../lib/locationStaleAt.ts";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/Avatar.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";
import { LiveMapBottomSheet } from "./LiveMapBottomSheet.tsx";

type PersonDevice = {
  battery: { charging: boolean; level: number } | null;
  deviceId: string;
  icon: DeviceIcon;
  isThisDevice: boolean;
  name: string;
  platform: string | null;
  timestamp: string | null;
  unreadable: boolean;
};

export const LiveMapPersonSheet = ({
  battery,
  devices,
  image,
  initials,
  isSelf = false,
  name,
  onDismiss,
  onHeightChange,
  onSelectDevice,
  otherSharedGroupNames,
  timestamp,
  unreadableGroup,
}: {
  battery: { charging: boolean; level: number } | null;
  devices?: readonly PersonDevice[] | undefined;
  image: string | null;
  initials: string;
  isSelf?: boolean;
  name: string;
  onDismiss: () => void;
  onHeightChange?: (height: number) => void;
  onSelectDevice?: (deviceId: string) => void;
  otherSharedGroupNames: readonly string[];
  timestamp: string | null;
  unreadableGroup?: { id: string; name: string } | undefined;
}) => {
  const updatedAge = useTimeSince(timestamp);
  const isMultiDevice = devices !== undefined && devices.length >= 2;
  const isOutOfDate = !isSelf && timestamp !== null && Date.now() >= locationStaleAt(timestamp);
  const batteryVisual = battery
    ? getBatteryVisual({
        batteryLevel: battery.level,
        charging: battery.charging,
      })
    : null;

  return (
    <LiveMapBottomSheet
      accessibilityLabel={`${name} details`}
      onDismiss={onDismiss}
      onHeightChange={onHeightChange}
      header={
        <>
          <View className="flex-row items-center gap-3">
            <Avatar alt={name} className="size-12">
              {image ? <AvatarImage source={{ uri: image }} /> : null}
              <AvatarFallback>
                <Text className="font-bold">{initials}</Text>
              </AvatarFallback>
            </Avatar>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-foreground text-xl font-bold">{name}</Text>
              <Text className="text-muted text-sm">
                {isMultiDevice
                  ? `${devices.length} devices`
                  : updatedAge === null
                    ? "No location sent yet"
                    : `${isSelf ? "Location sent" : "Updated"} ${updatedAge}`}
              </Text>
            </View>
          </View>
          {isMultiDevice ? (
            <View className="mt-3 gap-1">
              {devices.map((device) => (
                <PersonDeviceRow
                  key={device.deviceId}
                  device={device}
                  onPress={() => onSelectDevice?.(device.deviceId)}
                />
              ))}
            </View>
          ) : null}
          {!isMultiDevice && isOutOfDate && !unreadableGroup ? (
            <View className="mt-3 rounded-xl bg-background p-3">
              <Text className="text-sm">
                {name}’s phone hasn’t sent a location since then. It might be offline, out of
                battery, or have location turned off.
              </Text>
            </View>
          ) : null}
          {!isMultiDevice && battery && batteryVisual ? (
            <View className="mt-3 flex-row items-center gap-2">
              <Icon as={batteryVisual.icon} size={20} className={batteryVisual.colorClass} />
              <Text className={`${batteryVisual.colorClass} text-sm`}>
                Battery: {battery.level}%
              </Text>
            </View>
          ) : null}
          {otherSharedGroupNames.length > 0 ? (
            <Text className="text-muted-foreground mt-2 text-sm">
              Also in {otherSharedGroupNames.join(", ")}
            </Text>
          ) : null}
        </>
      }
    >
      {unreadableGroup ? (
        <View className="mt-3 gap-2 rounded-xl border border-destructive p-3">
          <Text className="text-sm">
            {isMultiDevice
              ? `Some of ${name}’s newer locations were encrypted with a key this phone doesn’t have.`
              : `${name}’s newer locations were encrypted with a key this phone doesn’t have, so this is the last location it can read.`}
          </Text>
          <Link
            href={{
              pathname: "/(tabs)/groups/[groupId]",
              params: { groupId: unreadableGroup.id },
            }}
            asChild
          >
            <Pressable accessibilityRole="link" className="min-h-11 justify-center self-start">
              <Text className="font-semibold text-destructive">Open {unreadableGroup.name}</Text>
            </Pressable>
          </Link>
        </View>
      ) : undefined}
    </LiveMapBottomSheet>
  );
};

const PersonDeviceRow = ({ device, onPress }: { device: PersonDevice; onPress: () => void }) => {
  const updatedAge = useTimeSince(device.timestamp);
  const batteryVisual = device.battery
    ? getBatteryVisual({ batteryLevel: device.battery.level, charging: device.battery.charging })
    : null;
  const label = device.isThisDevice ? `${device.name} (this phone)` : device.name;
  const updated = device.unreadable
    ? "Newer location can’t be read"
    : updatedAge === null
      ? "No location yet"
      : `${device.isThisDevice ? "Location sent" : "Updated"} ${updatedAge}`;
  const batteryLevel = device.battery && batteryVisual ? `${device.battery.level}%` : null;

  const content = (
    <>
      <View className="size-9 items-center justify-center rounded-xl border border-border bg-background">
        <Icon
          as={deviceIconFor(device.icon, device.platform).icon}
          size={18}
          className="text-foreground"
        />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-foreground font-semibold" numberOfLines={1}>
          {label}
        </Text>
        <Text
          className={device.unreadable ? "text-destructive text-sm" : "text-muted text-sm"}
          numberOfLines={1}
        >
          {updated}
        </Text>
      </View>
      {batteryVisual && batteryLevel ? (
        <View className="flex-row items-center gap-1">
          <Icon as={batteryVisual.icon} size={18} className={batteryVisual.colorClass} />
          <Text className={`${batteryVisual.colorClass} text-sm`}>{batteryLevel}</Text>
        </View>
      ) : null}
    </>
  );

  return device.timestamp === null ? (
    <View className="min-h-11 flex-row items-center gap-3 py-1.5">{content}</View>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[`Show ${label}`, updated, batteryLevel && `battery ${batteryLevel}`]
        .filter(Boolean)
        .join(", ")}
      className="min-h-11 flex-row items-center gap-3 py-1.5 active:opacity-70"
      onPress={onPress}
    >
      {content}
    </Pressable>
  );
};
