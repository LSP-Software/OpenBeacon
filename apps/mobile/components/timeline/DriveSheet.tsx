import type { DriveRecord } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import {
  BatteryLowIcon,
  EllipsisVerticalIcon,
  SmartphoneIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
  UserRoundIcon,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert } from "../../lib/alert.ts";
import {
  formatDriveDuration,
  drivingEventLines,
  drivingScoreReason,
} from "../../lib/driveFormat.ts";
import { drivingScore, drivingScoreCostLabel } from "../../lib/drivingScore.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";
import { type DistanceUnit, formatDistance, formatSpeed, type SpeedUnit } from "../../lib/units.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";
import { DriveScoreBadge, DrivingEventIcon } from "./DriveBadges.tsx";

export const DriveSheet = ({
  date,
  deviceName,
  driverName,
  formatClock,
  groupNames,
  isOwn,
  onClose,
  onDelete,
  onDriving,
  onHeight,
  onPassenger,
  placeNameAt,
  record,
  recordedHere,
  title,
  units,
}: {
  date: string;
  deviceName: string;
  driverName: string;
  formatClock: (time: number) => string;
  groupNames: readonly string[];
  isOwn: boolean;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onDriving: () => Promise<void>;
  onHeight: (height: number) => void;
  onPassenger: () => Promise<void>;
  placeNameAt: (position: { latitude: number; longitude: number }) => string | null;
  record: DriveRecord;
  recordedHere: boolean;
  title: string;
  units: { distance: DistanceUnit; speed: SpeedUnit };
}) => {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const score = drivingScore(record);
  const reason = drivingScoreReason(record, units.distance);
  const groups = listNames(groupNames);
  const events = [...record.events].sort((first, second) => first.timeOffset - second.timeOffset);

  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    const result = await tryCatch(action());
    setBusy(false);
    if (result.error) Alert.alert(failure, "Check your connection and try again.");
  };

  const confirmPassenger = () => {
    setMenuOpen(false);
    Alert.alert(
      "Were you a passenger?",
      `${groups} will still see this drive, but not its score or Driving events. It won’t count in your weekly driving report.\n\n${recordedHere ? `Only this ${thisDeviceNoun()} can undo it.` : `Only ${deviceName}, which recorded it, can undo it.`}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "I was a passenger",
          onPress: () => void run(onPassenger, "Couldn’t mark this drive"),
        },
      ],
    );
  };

  const confirmDelete = () => {
    setMenuOpen(false);
    Alert.alert(
      "Delete this drive?",
      `It’s removed for you and everyone in ${groups}, for good. Your Timeline still shows where you went.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void run(onDelete, "Couldn’t delete this drive"),
        },
      ],
    );
  };

  return (
    <View
      className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-card shadow-md shadow-black/15"
      style={{ maxHeight: height * 0.62 }}
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close drive"
        onPress={onClose}
        className="items-center py-3"
      >
        <View className="h-1 w-10 rounded-full bg-border-strong" />
      </Pressable>
      <ScrollView
        contentContainerClassName="gap-4 px-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      >
        <View className="flex-row items-start gap-2">
          <View className="flex-1 gap-0.5">
            <Text accessibilityRole="header" className="text-2xl text-foreground">
              {title}
            </Text>
            <Text className="text-sm text-secondary">
              {date} · {formatClock(record.start.time)}–{formatClock(record.end.time)} ·{" "}
              {deviceName}
            </Text>
          </View>
          {isOwn ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Drive actions"
              accessibilityState={{ expanded: menuOpen, disabled: busy }}
              disabled={busy}
              onPress={() => setMenuOpen((open) => !open)}
              className="size-11 items-center justify-center rounded-full"
            >
              <Icon as={EllipsisVerticalIcon} size={22} className="text-foreground" />
            </Pressable>
          ) : null}
        </View>

        {menuOpen ? (
          <View className="self-end rounded-2xl bg-container p-1">
            {record.passenger ? null : (
              <MenuItem
                icon={UserRoundIcon}
                label="I was a passenger"
                detail="Hide the score and events from others"
                onPress={confirmPassenger}
              />
            )}
            <MenuItem icon={Trash2Icon} label="Delete drive" destructive onPress={confirmDelete} />
          </View>
        ) : null}

        {score ? (
          <View className="flex-row items-center gap-4">
            <DriveScoreBadge large score={score.score} />
            <View className="flex-1 gap-1">
              <Text className="text-lg font-semibold text-foreground">Driving score</Text>
              {reason ? <Text className="text-sm text-secondary">{reason}</Text> : null}
              {score.costs.length > 0 ? (
                <Text className="text-sm text-secondary">
                  {score.costs.map(drivingScoreCostLabel).join(" · ")}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        <View className="flex-row flex-wrap gap-2">
          <Figure value={formatDistance(record.distance, units.distance)} label="distance" />
          <Figure value={formatDriveDuration(record.duration)} label="duration" />
          <Figure value={formatSpeed(record.topSpeed, units.speed)} label="top speed" />
          <Figure value={formatSpeed(record.averageSpeed, units.speed)} label="average" />
        </View>

        {record.passenger ? (
          <View className="gap-3">
            <View className="flex-row items-center gap-3 rounded-2xl bg-container p-3">
              {isOwn ? (
                <Icon as={UserRoundIcon} size={20} className="text-foreground" />
              ) : (
                <DriveScoreBadge score={null} />
              )}
              <Text className="flex-1 text-sm text-foreground">
                {isOwn
                  ? "You were a passenger. Others see this drive without a score or Driving events."
                  : `${driverName} was a passenger, so this drive has no Driving score or Driving events.`}
              </Text>
            </View>
            {isOwn && recordedHere ? (
              <Button
                variant="secondary"
                loading={busy}
                onPress={() => void run(onDriving, "Couldn’t change this drive")}
              >
                <Icon as={Undo2Icon} size={18} className="text-foreground" />
                <Text>I was driving</Text>
              </Button>
            ) : null}
            {isOwn && !recordedHere ? (
              <View className="flex-row items-center gap-3 rounded-2xl border border-border p-3">
                <Icon as={SmartphoneIcon} size={18} className="text-secondary" />
                <Text className="flex-1 text-sm text-secondary">
                  Marked as a passenger. Only {deviceName}, which recorded it, can undo it.
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View className="gap-1">
            {events.length > 0 ? (
              <Text className="text-xs font-semibold uppercase text-secondary">
                Possible Driving events
              </Text>
            ) : null}
            {events.map((event) => {
              const lines = drivingEventLines(event, units.speed);
              const place = placeNameAt(event);
              const detail = [
                formatClock(record.start.time + event.timeOffset * 1_000),
                lines.detail,
                place,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <View
                  key={`${event.type}:${event.timeOffset}:${event.latitude}:${event.longitude}`}
                  className="flex-row items-center gap-3 border-b border-border py-2.5"
                >
                  <DrivingEventIcon type={event.type} />
                  <View className="flex-1">
                    <Text className="font-semibold text-foreground">{lines.title}</Text>
                    <Text className="text-sm text-secondary">{detail}</Text>
                  </View>
                </View>
              );
            })}
            {score && score.costs.reduce((total, cost) => total + cost.count, 0) > events.length ? (
              <Text className="text-xs text-secondary">
                The rest of the possible Driving events on this drive have no place, so they aren’t
                listed. They still count in the score.
              </Text>
            ) : null}
          </View>
        )}

        {!record.passenger && !record.speedLimitsChecked ? (
          <Note
            icon={TriangleAlertIcon}
            title="Speeding not checked"
            body="Speed limits on these roads are unknown, so speeding isn’t in the score. The drive is dotted on the map."
          />
        ) : null}
        {score && score.uncheckedDistance > 0 ? (
          <Note
            icon={BatteryLowIcon}
            title="Not checked: phone was saving battery"
            body={`Braking, acceleration and speeding weren’t looked for on ${formatDistance(score.uncheckedDistance, units.distance)} of this drive.`}
          />
        ) : null}
      </ScrollView>
    </View>
  );
};

const listNames = (names: readonly string[]) => {
  if (names.length === 0) return "Your groups";
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

const MenuItem = ({
  destructive = false,
  detail,
  icon,
  label,
  onPress,
}: {
  destructive?: boolean;
  detail?: string;
  icon: typeof Trash2Icon;
  label: string;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityRole="button"
    onPress={onPress}
    className="min-h-12 flex-row items-center gap-3 rounded-xl px-3 py-2"
  >
    <Icon as={icon} size={18} className={destructive ? "text-destructive" : "text-foreground"} />
    <View>
      <Text className={destructive ? "text-destructive" : "text-foreground"}>{label}</Text>
      {detail ? <Text className="text-xs text-secondary">{detail}</Text> : null}
    </View>
  </Pressable>
);

const Figure = ({ label, value }: { label: string; value: string }) => (
  <View className="min-w-[72px] flex-1 rounded-2xl bg-container px-3 py-2">
    <Text adjustsFontSizeToFit numberOfLines={1} className="text-lg font-semibold text-foreground">
      {value}
    </Text>
    <Text className="text-xs text-secondary">{label}</Text>
  </View>
);

const Note = ({ body, icon, title }: { body: string; icon: typeof Trash2Icon; title: string }) => (
  <View className="flex-row gap-3 rounded-2xl bg-warning p-3">
    <Icon as={icon} size={18} className="text-warning-accent" />
    <View className="flex-1">
      <Text className="text-sm font-semibold text-foreground">{title}</Text>
      <Text className="text-sm text-foreground">{body}</Text>
    </View>
  </View>
);
