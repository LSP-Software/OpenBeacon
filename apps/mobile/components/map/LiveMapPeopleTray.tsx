import { useRef } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { cn } from "../../lib/cn.ts";
import type { MapPeople, MapPerson } from "../../lib/mapPeopleTypes.ts";
import { shortTimeSince } from "../../lib/timeSince.ts";
import { Text } from "../ui/Text.tsx";
import { LiveMapMarkerPin } from "./LiveMapMarkerPin.tsx";

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
    { key: "upToDate", label: "Up to date", markers: people.upToDate },
    { key: "outOfDate", label: "Out of date", markers: people.outOfDate },
    { key: "cantLocate", label: "Can't locate", missing: people.cantLocate },
    { key: "cantRead", label: "Can't read", missing: people.cantRead, isProblem: true },
  ].filter((section) => (section.markers ?? section.missing ?? []).length > 0);
  const pending = people.finding.length > 0 ? people.finding : people.waiting;
  const pendingLabel = people.finding.length > 0 ? "Finding" : "Waiting for connection";

  return (
    <View
      accessibilityLabel="People"
      className="absolute bottom-0 left-0 right-0 rounded-t-2xl border-t border-border bg-card pb-2 pt-3 shadow-md shadow-black/15"
      onLayout={(event) => onHeightChange(event.nativeEvent.layout.height)}
    >
      {people.waiting.length > 0 ? (
        <View className="mx-3 mb-2 rounded-lg border border-amber-600 px-3 py-1.5 dark:border-amber-400">
          <Text className="text-xs text-amber-700 dark:text-amber-400">
            Can’t reach the server. Locations shown may be out of date.
          </Text>
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-1.5 px-3 pb-2">
        {sections.map((section) => {
          const count = (section.markers ?? section.missing ?? []).length;
          return (
            <Pressable
              key={section.key}
              accessibilityRole="button"
              accessibilityLabel={`Show ${count} ${section.label.toLowerCase()}`}
              className={cn(
                "flex-row items-center gap-1 rounded-full border px-2.5 py-1 active:opacity-70",
                section.isProblem ? "border-destructive" : "border-border",
              )}
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
                  section.isProblem ? "text-destructive" : "text-foreground",
                )}
              >
                {count} {section.label.toLowerCase()}
              </Text>
            </Pressable>
          );
        })}
        {pending.length > 0 ? (
          <View className="flex-row items-center gap-1 rounded-full border border-border px-2.5 py-1">
            <ActivityIndicator size="small" />
            <Text className="text-xs font-semibold text-foreground">
              {pendingLabel} {pending.length}
            </Text>
          </View>
        ) : null}
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
                section.isProblem ? "text-destructive" : "text-muted",
              )}
            >
              {section.label}
            </Text>
            <View className="flex-row gap-2">
              {section.markers?.map((marker) => (
                <TrayPerson
                  key={marker.userId}
                  accessibilityLabel={`${marker.isSelf ? "You" : marker.name}, ${section.label.toLowerCase()}`}
                  age={marker.timestamp === null ? null : shortTimeSince(marker.timestamp, now)}
                  marker={marker}
                  onPress={() => onSelectPerson(marker.userId)}
                />
              ))}
              {section.missing?.map((person) => (
                <TrayPerson
                  key={person.userId}
                  accessibilityLabel={`${person.name}, ${section.label.toLowerCase()}`}
                  age={null}
                  person={person}
                  status={section.key === "cantRead" ? "cantRead" : "cantLocate"}
                  onPress={() => onSelectPerson(person.userId)}
                />
              ))}
            </View>
          </View>
        ))}
        {pending.length > 0 ? (
          <View className={cn(sections.length > 0 && "ml-3 border-l border-border pl-3")}>
            <Text className="mb-1 text-[11px] font-bold uppercase text-muted">{pendingLabel}</Text>
            <View className="h-16 flex-row items-center gap-2 px-1">
              <ActivityIndicator size="small" />
              <Text className="text-xs text-muted">
                {pending.length} {pending.length === 1 ? "person" : "people"}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
};

const TrayPerson = ({
  accessibilityLabel,
  age,
  marker,
  onPress,
  person,
  status,
}: {
  accessibilityLabel: string;
  age: string | null;
  marker?: LiveMapMarker;
  onPress: () => void;
  person?: MapPerson;
  status?: "cantLocate" | "cantRead";
}) => {
  const subject = marker ?? person;
  if (!subject) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="w-14 items-center active:opacity-70"
      onPress={onPress}
    >
      <LiveMapMarkerPin
        image={subject.image}
        initials={subject.initials}
        name={subject.name}
        ringColor={marker?.ringColor ?? "transparent"}
        ringColors={marker?.ringColors}
        status={status}
        timestamp={marker?.timestamp ?? null}
      />
      <Text className="mt-0.5 text-[11px] font-semibold text-foreground" numberOfLines={1}>
        {marker?.isSelf ? "You" : subject.name}
      </Text>
      {age !== null ? <Text className="text-[10px] leading-3 text-muted">{age}</Text> : null}
    </Pressable>
  );
};
