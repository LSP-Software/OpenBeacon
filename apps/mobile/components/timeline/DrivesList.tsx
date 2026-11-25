import type { DriveRecord } from "@openbeacon/encryption";
import { CarIcon, FuelIcon, InfoIcon, SmartphoneIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";
import { DriveScoreBadge } from "./DriveBadges.tsx";

export const DrivesList = <Drive extends { driveId: string; record: DriveRecord }>({
  days,
  emptyText,
  footer,
  formatClock,
  header,
  loading,
  onOpen,
  otherDeviceNote,
  placeName,
  rowOf,
  top,
}: {
  days: ReadonlyArray<{
    items: ReadonlyArray<
      { drive: Drive; kind: "drive" } | { kind: "stop"; minutes: number; placeId: string | null }
    >;
    key: string;
    otherDevices: ReadonlyArray<{ count: number; deviceId: string }>;
    start: number;
  }>;
  emptyText: string;
  footer: ReactNode;
  formatClock: (time: number) => string;
  header: ReactNode;
  loading: boolean;
  onOpen: (drive: Drive) => void;
  otherDeviceNote: (
    day: { key: string; start: number },
    other: { count: number; deviceId: string },
  ) => { label: string; onPress: () => void };
  placeName: (placeId: string | null) => string | null;
  rowOf: (drive: Drive) => {
    figures: string;
    score: number | null;
    title: string;
  };
  top: number;
}) => {
  const insets = useSafeAreaInsets();
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const dayLabel = (start: number) => {
    const date = new Date(start);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "short",
    });
  };
  const hasDrives = days.some((day) => day.items.length > 0);
  return (
    <ScrollView
      className="absolute inset-x-0 bottom-0 bg-background"
      style={{ top }}
      contentContainerClassName="gap-2 px-3 pt-3"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
    >
      {header}
      {loading ? <ActivityIndicator className="py-6 text-primary" /> : null}
      {!loading && !hasDrives ? (
        <View className="items-center gap-2 py-8">
          <Icon as={CarIcon} size={28} className="text-tertiary" />
          <Text className="text-center text-tertiary">{emptyText}</Text>
        </View>
      ) : null}
      {days.map((day) => (
        <View key={day.key} className="gap-2">
          <Text
            accessibilityRole="header"
            className="px-2 pt-2 text-xs font-semibold uppercase text-secondary"
          >
            {dayLabel(day.start)}
          </Text>
          {day.items.length > 0 ? (
            <View className="overflow-hidden rounded-3xl bg-card">
              {day.items.map((item, index) => {
                if (item.kind === "stop") {
                  const place = placeName(item.placeId);
                  return (
                    <View
                      key={`stop:${stopKey(day.items[index - 1])}`}
                      className="flex-row items-center gap-2 bg-container px-4 py-2"
                    >
                      <Icon as={FuelIcon} size={16} className="text-secondary" />
                      <Text className="text-sm text-secondary">
                        Stopped {item.minutes} min{place ? ` at ${place}` : ""}
                      </Text>
                    </View>
                  );
                }
                const row = rowOf(item.drive);
                const { record } = item.drive;
                return (
                  <Pressable
                    key={item.drive.driveId}
                    accessibilityRole="button"
                    accessibilityLabel={`${formatClock(record.start.time)} to ${formatClock(record.end.time)}, ${row.title}${record.passenger ? ", passenger" : ""}, ${row.figures}${row.score === null ? "" : `, Driving score ${row.score}`}`}
                    onPress={() => onOpen(item.drive)}
                    className="flex-row items-center gap-3 border-b border-border px-4 py-3"
                  >
                    <View className="shrink-0">
                      <Text className="text-foreground" numberOfLines={1}>
                        {formatClock(record.start.time)}
                      </Text>
                      <Text className="text-foreground" numberOfLines={1}>
                        {formatClock(record.end.time)}
                      </Text>
                    </View>
                    <View className="flex-1 gap-0.5">
                      <Text className="text-lg text-foreground" numberOfLines={2}>
                        {row.title}
                      </Text>
                      {record.passenger ? (
                        <View className="self-start rounded-md bg-primary-soft px-2 py-0.5">
                          <Text className="text-xs text-foreground">Passenger</Text>
                        </View>
                      ) : null}
                      <Text className="text-secondary">{row.figures}</Text>
                    </View>
                    <DriveScoreBadge score={row.score} />
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {day.otherDevices.map((other) => {
            const note = otherDeviceNote(day, other);
            return (
              <Pressable
                key={other.deviceId}
                accessibilityRole="button"
                onPress={note.onPress}
                className="flex-row items-center gap-3 rounded-2xl bg-primary-soft px-4 py-3"
              >
                <Icon as={SmartphoneIcon} size={18} className="text-secondary" />
                <Text className="flex-1 text-sm text-foreground">{note.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      {footer}
    </ScrollView>
  );
};

export const DriveInfoBox = ({ text }: { text: string }) => (
  <View className="flex-row items-center gap-3 rounded-2xl bg-container px-4 py-3">
    <Icon as={InfoIcon} size={18} className="text-secondary" />
    <Text className="flex-1 text-sm text-foreground">{text}</Text>
  </View>
);

const stopKey = (
  before: { drive: { driveId: string }; kind: "drive" } | { kind: "stop" } | undefined,
) => (before?.kind === "drive" ? before.drive.driveId : "first");
