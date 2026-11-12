import { memo, useRef } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { cn } from "../../lib/cn.ts";
import type { MapPeople, MapPerson, MapPersonStatus } from "../../lib/mapPeopleTypes.ts";
import { shortTimeSince, timeSince } from "../../lib/timeSince.ts";
import { Text } from "../ui/Text.tsx";
import { LiveMapMarkerPin } from "./LiveMapMarkerPin.tsx";

const countPeople = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;

export const LiveMapPeopleTray = ({
  now,
  onHeightChange,
  onSelectPerson,
  people,
}: {
  now: number;
  onHeightChange: (height: number) => void;
  onSelectPerson: (userId: string) => void;
  people: MapPeople;
}) => {
  const scrollRef = useRef<ScrollView>(null);
  const sectionXRef = useRef<Record<string, number>>({});
  const sections = [
    { key: "upToDate", label: "Up to date", people: people.upToDate, status: null },
    { key: "outOfDate", label: "Out of date", people: people.outOfDate, status: null },
    { key: "paused", label: "Paused", people: people.paused, status: "paused" as const },
    {
      key: "cantLocate",
      label: "Can’t locate",
      people: people.cantLocate,
      status: "cantLocate" as const,
    },
    {
      key: "cantRead",
      label: "Needs attention",
      people: people.cantRead,
      status: "cantRead" as const,
    },
    { key: "hidden", label: "Hidden", people: people.hidden, status: "hidden" as const },
  ].filter((section) => section.people.length > 0);
  const pendingSections = [
    { key: "finding", label: "Finding", chip: "Finding", count: people.finding.length },
    {
      key: "waiting",
      label: "Waiting for connection",
      chip: "Waiting for",
      count: people.waiting.length,
    },
  ].filter((section) => section.count > 0);

  return (
    <View
      className="absolute bottom-0 left-0 right-0 rounded-t-2xl border-t border-border bg-card pb-2 pt-3 shadow-md shadow-black/15"
      onLayout={(event) => onHeightChange(event.nativeEvent.layout.height)}
    >
      {people.connectionLost ? (
        <View className="mx-3 mb-2 rounded-lg border border-amber-600 px-3 py-1.5 dark:border-amber-400">
          <Text className="text-xs text-amber-700 dark:text-amber-400">
            Can’t reach the server. Locations shown may be out of date.
          </Text>
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-1.5 px-3 pb-2">
        {sections.map((section) => {
          const isProblem = section.status === "cantRead";
          const chipLabel =
            isProblem && section.people.length > 1 ? "need attention" : section.label.toLowerCase();
          return (
            <Pressable
              key={section.key}
              accessibilityRole="button"
              accessibilityLabel={`Show ${section.people.length} ${chipLabel}`}
              className={cn(
                "flex-row items-center gap-1 rounded-full border px-2.5 py-1 active:opacity-70",
                isProblem ? "border-destructive" : "border-border",
                section.status === "hidden" && "border-dashed",
              )}
              hitSlop={{ top: 9, bottom: 9 }}
              onPress={() => {
                scrollRef.current?.scrollTo({
                  x: sectionXRef.current[section.key] ?? 0,
                  animated: true,
                });
              }}
            >
              <Text
                className={cn(
                  "text-xs font-semibold",
                  isProblem ? "text-destructive" : "text-foreground",
                )}
              >
                {section.people.length} {chipLabel}
              </Text>
            </Pressable>
          );
        })}
        {pendingSections.map((section) => (
          <View
            key={section.key}
            className="flex-row items-center gap-1 rounded-full border border-border px-2.5 py-1"
          >
            <ActivityIndicator size="small" />
            <Text className="text-xs font-semibold text-foreground">
              {section.chip} {countPeople(section.count)}
            </Text>
          </View>
        ))}
      </View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="px-3"
      >
        {sections.map((section, index) => (
          <View
            key={section.key}
            className={cn(index > 0 && "ml-3 border-l border-border pl-3")}
            onLayout={(event) => {
              sectionXRef.current[section.key] = Math.max(0, event.nativeEvent.layout.x - 12);
            }}
          >
            <Text
              className={cn(
                "mb-1 text-[11px] font-bold uppercase",
                section.status === "cantRead"
                  ? "text-destructive"
                  : "text-muted dark:text-muted-foreground",
              )}
            >
              {section.label}
            </Text>
            <View className="flex-row gap-2">
              {section.people.map((person) => {
                const timestamp = "timestamp" in person ? person.timestamp : null;
                const hasUnreadableUpdate =
                  "unreadableGroup" in person && person.unreadableGroup !== undefined;
                const name = person.isSelf ? "You" : person.name;
                return (
                  <TrayPerson
                    key={person.userId}
                    accessibilityLabel={[
                      name,
                      section.label.toLowerCase(),
                      ...(timestamp === null ? [] : [`updated ${timeSince(timestamp, now)}`]),
                      ...(hasUnreadableUpdate ? ["newer location can’t be read"] : []),
                    ].join(", ")}
                    hasUnreadableUpdate={hasUnreadableUpdate}
                    age={timestamp === null ? null : shortTimeSince(timestamp, now)}
                    person={person}
                    ringColor={"ringColor" in person ? person.ringColor : "transparent"}
                    ringColors={"ringColors" in person ? person.ringColors : undefined}
                    status={section.status}
                    timestamp={timestamp}
                    onSelectPerson={onSelectPerson}
                  />
                );
              })}
            </View>
          </View>
        ))}
        {pendingSections.map((section, index) => (
          <View
            key={section.key}
            className={cn((sections.length > 0 || index > 0) && "ml-3 border-l border-border pl-3")}
          >
            <Text className="mb-1 text-[11px] font-bold uppercase text-muted dark:text-muted-foreground">
              {section.label}
            </Text>
            <View className="h-16 flex-row items-center gap-2 px-1">
              <ActivityIndicator size="small" />
              <Text className="text-xs text-muted dark:text-muted-foreground">
                {countPeople(section.count)}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const TrayPerson = memo(
  ({
    accessibilityLabel,
    age,
    hasUnreadableUpdate,
    onSelectPerson,
    person,
    ringColor,
    ringColors,
    status,
    timestamp,
  }: {
    accessibilityLabel: string;
    age: string | null;
    hasUnreadableUpdate: boolean;
    onSelectPerson: (userId: string) => void;
    person: MapPerson | LiveMapMarker;
    ringColor: string;
    ringColors: string[] | undefined;
    status: MapPersonStatus | null;
    timestamp: string | null;
  }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="w-14 items-center active:opacity-70"
      onPress={() => onSelectPerson(person.userId)}
    >
      <LiveMapMarkerPin
        hasUnreadableUpdate={hasUnreadableUpdate}
        image={person.image}
        initials={person.initials}
        name={person.name}
        ringColor={ringColor}
        ringColors={ringColors}
        status={status}
        timestamp={timestamp}
      />
      <Text className="mt-0.5 text-[11px] font-semibold text-foreground" numberOfLines={1}>
        {person.isSelf ? "You" : person.name.trim().split(/\s+/)[0] || person.name}
      </Text>
      {age !== null ? (
        <Text className="text-[10px] leading-3 text-muted dark:text-muted-foreground">{age}</Text>
      ) : null}
    </Pressable>
  ),
);
