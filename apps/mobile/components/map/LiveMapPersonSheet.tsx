import { Link } from "expo-router";
import {
  CircleCheckIcon,
  GaugeIcon,
  HistoryIcon,
  RadioIcon,
  TriangleAlertIcon,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useLiveSpeedLabel } from "../../hooks/useLiveSpeedLabel.ts";
import { useUnits } from "../../hooks/useUnits.ts";
import { type CrashIncident, formatClock } from "../../lib/crashAlertInbox.ts";
import { formatSpeed } from "../../lib/units.ts";
import { useTimeSince } from "../../hooks/useTimeSince.ts";
import { shortTimeSince } from "../../lib/timeSince.ts";
import { getBatteryVisual } from "../../lib/batteryVisual.ts";
import { type DeviceIcon, deviceIconFor } from "../../lib/deviceIcons.ts";
import { locationStaleAt } from "../../lib/locationStaleAt.ts";
import { mayBeOutOfBattery } from "../../lib/mayBeOutOfBattery.ts";
import { DecryptedAvatarImage } from "../image/DecryptedAvatarImage.tsx";
import { Avatar, AvatarFallback } from "../ui/Avatar.tsx";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";
import { LiveMapBottomSheet } from "./LiveMapBottomSheet.tsx";
import { RequestUpdateButton } from "./RequestUpdateButton.tsx";
import { DirectionsButton } from "./DirectionsButton.tsx";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

type PersonDevice = {
  battery: { charging: boolean; level: number | null } | null;
  deviceId: string;
  icon: DeviceIcon;
  isThisDevice: boolean;
  name: string;
  paused: boolean;
  platform: string | null;
  speed: number | null;
  timestamp: string | null;
  unreadable: boolean;
};

export const LiveMapPersonSheet = ({
  battery,
  crash = null,
  destination,
  devices,
  image,
  initials,
  isSelf = false,
  liveUntilMs,
  name,
  onDismiss,
  onHeightChange,
  onRequestUpdate,
  onSelectDevice,
  otherSharedGroupNames,
  speed,
  timeline,
  timestamp,
  unreadableGroup,
}: {
  battery: { charging: boolean; level: number | null } | null;
  crash?: CrashIncident | null;
  destination?: { latitude: number; longitude: number } | undefined;
  devices?: readonly PersonDevice[] | undefined;
  image: string | null;
  initials: string;
  isSelf?: boolean;
  liveUntilMs?: number | undefined;
  name: string;
  onDismiss: () => void;
  onHeightChange?: (height: number) => void;
  onRequestUpdate?: (() => Promise<void>) | undefined;
  onSelectDevice?: (deviceId: string) => void;
  otherSharedGroupNames: readonly string[];
  speed: number | null;
  timeline?: { groupId: string; userId: string } | undefined;
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
  const liveSpeed = useLiveSpeedLabel({ speed, timestamp });
  const speedLabel = isMultiDevice ? null : liveSpeed;
  const [, setLiveEnded] = useState(0);
  const isLive = !isMultiDevice && !isSelf && liveUntilMs !== undefined && Date.now() < liveUntilMs;

  useEffect(() => {
    if (liveUntilMs === undefined || liveUntilMs <= Date.now()) return;
    const timer = setTimeout(() => setLiveEnded((ended) => ended + 1), liveUntilMs - Date.now());
    return () => clearTimeout(timer);
  }, [liveUntilMs]);

  return (
    <LiveMapBottomSheet
      accessibilityLabel={`${name} details`}
      onDismiss={onDismiss}
      onHeightChange={onHeightChange}
      header={
        <>
          {crash && !isSelf ? <CrashAlertBlock crash={crash} name={name} /> : null}
          <View className="flex-row items-center gap-3">
            <Avatar alt={name} className="size-12">
              <DecryptedAvatarImage url={image} />
              <AvatarFallback>
                <Text className="font-bold">{initials}</Text>
              </AvatarFallback>
            </Avatar>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-foreground text-xl font-bold">{name}</Text>
              {isLive ? (
                <View className="flex-row items-center gap-1.5">
                  <Icon as={RadioIcon} size={16} className="text-success" />
                  <Text className="text-success text-sm font-medium">Updating live</Text>
                </View>
              ) : (
                <Text className="text-secondary text-sm">
                  {isMultiDevice
                    ? `${devices.length} devices`
                    : updatedAge === null
                      ? "No location sent yet"
                      : `${isSelf ? "Location sent" : "Updated"} ${updatedAge}`}
                </Text>
              )}
            </View>
          </View>
          {isMultiDevice ? (
            <View className="mt-3 gap-1">
              {devices.map((device) => (
                <PersonDeviceRow
                  key={device.deviceId}
                  device={device}
                  isSelf={isSelf}
                  onPress={() => onSelectDevice?.(device.deviceId)}
                />
              ))}
            </View>
          ) : null}
          {!isMultiDevice && isOutOfDate && !unreadableGroup ? (
            <View className="mt-3 rounded-2xl bg-container p-3">
              <Text className="text-sm">
                {mayBeOutOfBattery({ battery, timestamp })
                  ? `Battery was at ${battery?.level}%. ${name}’s phone may have run out.`
                  : `${name}’s phone hasn’t sent a location since then. It might be offline, out of battery, or have location turned off.`}
              </Text>
            </View>
          ) : null}
          {(!isMultiDevice && batteryVisual?.label) || speedLabel ? (
            <View className="mt-3 flex-row flex-wrap gap-2">
              {!isMultiDevice && batteryVisual?.label ? (
                <View
                  accessible
                  accessibilityLabel={`Battery ${batteryVisual.label}`}
                  className="flex-row items-center gap-1.5 rounded-full bg-container px-3 py-1.5"
                >
                  <Icon as={batteryVisual.icon} size={16} className={batteryVisual.colorClass} />
                  <Text className={`${batteryVisual.colorClass} text-sm font-medium`}>
                    {batteryVisual.label}
                  </Text>
                </View>
              ) : null}
              {speedLabel ? (
                <View
                  accessible
                  accessibilityLabel={`Moving at ${speedLabel}`}
                  className="flex-row items-center gap-1.5 rounded-full bg-container px-3 py-1.5"
                >
                  <Icon as={GaugeIcon} size={16} className="text-foreground" />
                  <Text className="text-foreground text-sm font-medium">{speedLabel}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {otherSharedGroupNames.length > 0 ? (
            <Text className="text-tertiary mt-2 text-sm">
              Also in {otherSharedGroupNames.join(", ")}
            </Text>
          ) : null}
          {onRequestUpdate && !isSelf ? (
            <RequestUpdateButton
              locationsKey={[
                timestamp,
                ...(devices ?? []).map((device) => device.timestamp),
              ].join()}
              hasLocation
              name={name}
              onRequestUpdate={onRequestUpdate}
              phones={isMultiDevice ? "devices" : "phone"}
            />
          ) : null}
          {destination && !isSelf ? (
            <DirectionsButton
              destination={destination}
              name={name}
              outOfDateAge={isOutOfDate || unreadableGroup ? updatedAge : null}
            />
          ) : null}
          {crash && !isSelf && !crash.ok ? (
            <Text className="text-secondary mt-3 text-sm">
              OpenBeacon hasn’t contacted emergency services. Call 999 if you think {name} needs
              help. Crash alerts may help, but they can go off when nothing happened.
            </Text>
          ) : null}
          {timeline ? (
            <Link href={{ pathname: "/timeline", params: timeline }} asChild>
              <Button variant="secondary" className="mt-4" accessibilityRole="link">
                <Icon as={HistoryIcon} size={18} className="text-foreground" />
                <Text>See today’s route</Text>
              </Button>
            </Link>
          ) : null}
        </>
      }
    >
      {unreadableGroup ? (
        <View className="mt-3 gap-2 rounded-2xl bg-destructive-soft p-3">
          <Text className="text-sm">
            {isMultiDevice
              ? `Some of ${name}’s newer locations were encrypted with a key this ${thisDeviceNoun()} doesn’t have.`
              : `${name}’s newer locations were encrypted with a key this ${thisDeviceNoun()} doesn’t have, so this is the last location it can read.`}
          </Text>
          <Link
            href={{
              pathname: "/(tabs)/groups/[groupId]",
              params: { groupId: unreadableGroup.id },
            }}
            asChild
          >
            <Pressable accessibilityRole="link" className="min-h-11 justify-center self-start">
              <Text className="font-semibold text-destructive-text">
                Open {unreadableGroup.name}
              </Text>
            </Pressable>
          </Link>
        </View>
      ) : undefined}
    </LiveMapBottomSheet>
  );
};

const CrashAlertBlock = ({ crash, name }: { crash: CrashIncident; name: string }) => {
  const { speed } = useUnits();
  const crashAt = formatClock(crash.crash.time);
  if (crash.ok) {
    return (
      <View
        accessibilityRole="alert"
        className="mb-3 flex-row gap-3 rounded-2xl p-3"
        style={{ backgroundColor: "#E6F2EA" }}
      >
        <CircleCheckIcon size={22} color="#1E6B3A" />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="font-semibold" style={{ color: "#1E6B3A" }}>
            {name} says they’re OK
          </Text>
          <Text className="text-sm" style={{ color: "#1E6B3A" }}>
            {formatClock(crash.ok.at)}, after a possible crash at {crashAt}
            {crash.placeLabel ? ` on ${crash.placeLabel}` : ""}
          </Text>
        </View>
      </View>
    );
  }
  const sharing =
    crash.sharingUntil !== null && crash.sharingUntil > Date.now()
      ? ` ${name}’s phone is sharing every 10 s until ${formatClock(crash.sharingUntil)}.`
      : "";
  return (
    <View
      accessibilityRole="alert"
      className="mb-3 flex-row gap-3 rounded-2xl p-3"
      style={{ backgroundColor: "#FBDCD8" }}
    >
      <TriangleAlertIcon size={22} color="#2A0A0C" />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-semibold" style={{ color: "#2A0A0C" }}>
          Possible crash at {crashAt}
        </Text>
        <Text className="text-sm" style={{ color: "#2A0A0C" }}>
          {crash.placeLabel ? `${crash.placeLabel}, ` : ""}
          {formatSpeed(crash.crash.speedBefore, speed)} just before.{sharing}
        </Text>
      </View>
    </View>
  );
};

const PersonDeviceRow = ({
  device,
  isSelf,
  onPress,
}: {
  device: PersonDevice;
  isSelf: boolean;
  onPress: () => void;
}) => {
  const updatedAge = useTimeSince(device.timestamp);
  const liveSpeed = useLiveSpeedLabel({ speed: device.speed, timestamp: device.timestamp });
  const speedLabel = device.paused ? null : liveSpeed;
  const batteryVisual = device.battery
    ? getBatteryVisual({ batteryLevel: device.battery.level, charging: device.battery.charging })
    : null;
  const label = device.isThisDevice ? `${device.name} (this ${thisDeviceNoun()})` : device.name;
  const updated = device.paused
    ? "Location sharing paused"
    : device.unreadable
      ? "Newer location can’t be read"
      : updatedAge === null
        ? "No location sent yet"
        : !isSelf && mayBeOutOfBattery(device)
          ? `May be out of battery, ${shortTimeSince(device.timestamp ?? "")} ago`
          : `${device.isThisDevice ? "Location sent" : "Updated"} ${updatedAge}`;
  const batteryLevel = batteryVisual?.label ?? null;

  const content = (
    <>
      <View className="size-9 items-center justify-center rounded-full bg-container">
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
          className={
            device.unreadable && !device.paused
              ? "text-destructive-text text-sm"
              : "text-secondary text-sm"
          }
          numberOfLines={1}
        >
          {updated}
        </Text>
      </View>
      {speedLabel ? (
        <View className="flex-row items-center gap-1">
          <Icon as={GaugeIcon} size={18} className="text-foreground" />
          <Text className="text-foreground text-sm">{speedLabel}</Text>
        </View>
      ) : null}
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
      accessibilityLabel={[
        `Show ${label}`,
        updated,
        speedLabel && `moving at ${speedLabel}`,
        batteryLevel && `battery ${batteryLevel}`,
      ]
        .filter(Boolean)
        .join(", ")}
      className="min-h-11 flex-row items-center gap-3 py-1.5 active:opacity-70"
      onPress={onPress}
    >
      {content}
    </Pressable>
  );
};
