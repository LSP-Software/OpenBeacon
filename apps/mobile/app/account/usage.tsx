import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import { Link } from "expo-router";
import { ChevronRightIcon, CircleSlashIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { SeatsSetting } from "../../components/SeatsSetting.tsx";
import { BottomSheet } from "../../components/ui/BottomSheet.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useAppForeground } from "../../hooks/useAppForeground.ts";
import { trpc } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { pluralize } from "../../lib/pluralize.ts";

const UsageScreen = () => {
  const isFocused = useIsFocused();
  const [selected, setSelected] = useState<{ groupId: string; userId: string | null } | null>(null);
  const usage = useQuery({
    ...trpc.account.usage.queryOptions(),
    staleTime: 0,
    subscribed: isFocused,
  });
  useAppForeground(() => {
    if (isFocused) void usage.refetch();
  });
  const seats = usage.data?.seats ?? null;
  const ownedGroups = usage.data?.groups.filter((group) => group.people !== null) ?? [];
  const otherGroups = usage.data?.groups.filter((group) => group.people === null) ?? [];
  const selectedGroup = usage.data?.groups.find((group) => group.id === selected?.groupId);
  const selectedPerson = selectedGroup?.people?.find(
    (person) => person.userId === selected?.userId,
  );

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Usage" />

      {!usage.data ? (
        <View className="flex-1 items-center justify-center gap-4 px-6">
          {usage.isError ? (
            <>
              <Text className="text-secondary text-center">
                Couldn’t load your usage. Check your connection and try again.
              </Text>
              <Button variant="secondary" onPress={() => void usage.refetch()}>
                <Text>Try again</Text>
              </Button>
            </>
          ) : (
            <LoadingIndicator />
          )}
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-6 px-4 pb-32 pt-2"
          showsVerticalScrollIndicator={false}
        >
          {seats && (
            <Text className="text-secondary text-base">
              Everyone in the groups you own, including you, counts once towards the people you have
              room for, however many of your groups they’re in and however many phones they have.
              Groups owned by someone else use their room, not yours.
            </Text>
          )}

          <View className="gap-3">
            {usage.data.gauges.map((gauge) => {
              const over = gauge.used > gauge.max;
              const full = gauge.used >= gauge.max;
              return (
                <View
                  key={gauge.id}
                  accessible
                  accessibilityLabel={`${gauge.label}: ${gauge.used} of ${gauge.max} used${gauge.onHold > 0 ? `, ${gauge.onHold} on hold` : ""}`}
                  className="gap-3 rounded-2xl border border-border bg-card p-5"
                >
                  <View className="flex-row items-baseline justify-between">
                    <Text className="text-foreground text-lg font-semibold">{gauge.label}</Text>
                    <Text className="text-tertiary text-base">
                      {gauge.used} of {pluralize(gauge.max, gauge.unit.one, gauge.unit.other)}
                    </Text>
                  </View>
                  <View className="h-3 overflow-hidden rounded-full bg-secondary">
                    <View
                      className={cn(
                        "h-full rounded-full",
                        over ? "bg-warning-accent" : full ? "bg-primary" : "bg-primary/70",
                      )}
                      style={{
                        width: `${gauge.max === 0 ? (gauge.used > 0 ? 100 : 0) : Math.min(100, (gauge.used / gauge.max) * 100)}%`,
                      }}
                    />
                  </View>
                  {gauge.onHold > 0 && (
                    <Text className="text-warning-text text-sm font-medium">
                      {pluralize(gauge.onHold, gauge.unit.one, gauge.unit.other)} on hold
                    </Text>
                  )}
                </View>
              );
            })}
          </View>

          {seats && seats.onHold > 0 && (
            <View className="gap-2 rounded-2xl border border-warning-accent bg-card p-5">
              <Text className="text-foreground font-semibold">
                {pluralize(seats.onHold, "person", "people")} {seats.onHold === 1 ? "is" : "are"} on
                hold
              </Text>
              <Text className="text-tertiary text-sm leading-5">
                {seats.seats === 0
                  ? "You don’t have room for anyone in the groups you own, so everyone in them is on hold."
                  : `You have room for ${pluralize(seats.seats, "person", "people")} in the groups you own, so the people who joined last are on hold.`}{" "}
                Their phones don’t share their location in your groups, and can’t see anyone there,
                until you have room. To make room, remove someone from your groups.
              </Text>
            </View>
          )}

          {seats?.selfSetAllowed && <SeatsSetting seats={seats} onChanged={usage.refetch} />}

          {ownedGroups.length > 0 && (
            <View className="gap-3">
              <Text variant="label">Groups you own</Text>
              {ownedGroups.map((group) => (
                <View
                  key={group.id}
                  className="overflow-hidden rounded-2xl border border-border bg-card"
                >
                  <View className="flex-row items-baseline justify-between border-b border-border/50 px-5 py-4">
                    <Text className="text-foreground flex-1 text-base font-semibold">
                      {group.name}
                    </Text>
                    <Text className="text-tertiary text-sm">
                      {pluralize(group.people?.length ?? 0, "person", "people")}
                    </Text>
                  </View>
                  {group.people?.map((person, index, people) => (
                    <Pressable
                      key={person.userId}
                      accessibilityRole="button"
                      accessibilityLabel={[
                        person.isYou ? "You" : person.name,
                        person.onHold ? "On hold" : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                      accessibilityHint="Opens details"
                      onPress={() => setSelected({ groupId: group.id, userId: person.userId })}
                      className={cn(
                        "flex-row items-center gap-3 px-5 py-3 active:bg-secondary/60",
                        index < people.length - 1 && "border-b border-border/50",
                      )}
                    >
                      <Text className="text-foreground flex-1 text-base">
                        {person.isYou ? "You" : person.name}
                      </Text>
                      {person.onHold && (
                        <Text className="text-warning-text text-sm font-medium">On hold</Text>
                      )}
                      <Icon as={ChevronRightIcon} className="size-4 text-tertiary" />
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
          )}

          {otherGroups.length > 0 && (
            <View className="gap-3">
              <Text variant="label">{seats ? "Groups owned by others" : "Your groups"}</Text>
              <View className="overflow-hidden rounded-2xl border border-border bg-card">
                {otherGroups.map((group, index) => (
                  <Pressable
                    key={group.id}
                    accessibilityRole="button"
                    accessibilityLabel={[
                      group.name,
                      group.isOwner ? "You own this group" : `Owned by ${group.owner.name}`,
                      group.youAreOnHold ? "You’re on hold here" : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    accessibilityHint="Opens details"
                    onPress={() => setSelected({ groupId: group.id, userId: null })}
                    className={cn(
                      "flex-row items-center gap-3 px-5 py-4 active:bg-secondary/60",
                      index < otherGroups.length - 1 && "border-b border-border/50",
                    )}
                  >
                    <View className="flex-1 gap-0.5">
                      <Text className="text-foreground text-base font-medium">{group.name}</Text>
                      <Text className="text-tertiary text-sm">
                        {group.isOwner ? "You own this group" : `Owned by ${group.owner.name}`}
                      </Text>
                      {group.youAreOnHold && (
                        <View className="mt-1 flex-row items-center gap-1.5">
                          <Icon as={CircleSlashIcon} className="size-4 text-warning-accent" />
                          <Text className="text-warning-text flex-1 text-sm">
                            You’re on hold here
                          </Text>
                        </View>
                      )}
                    </View>
                    <Icon as={ChevronRightIcon} className="size-4 text-tertiary" />
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <View className="gap-3">
            <Text variant="label">Limits</Text>
            <View className="overflow-hidden rounded-2xl border border-border bg-card">
              {usage.data.limits.map((limit, index, limits) => (
                <View
                  key={limit.id}
                  className={cn(
                    "flex-row items-center justify-between px-5 py-4",
                    index < limits.length - 1 && "border-b border-border/50",
                  )}
                >
                  <Text className="text-foreground text-base">{limit.label}</Text>
                  <Text className="text-tertiary text-base">
                    {pluralize(limit.value, limit.unit.one, limit.unit.other)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}

      <BottomSheet
        visible={
          selectedGroup !== undefined && (selected?.userId === null || selectedPerson !== undefined)
        }
        onClose={() => setSelected(null)}
        closeLabel="Close details"
      >
        {selectedGroup && selectedPerson ? (
          <>
            <View className="gap-1">
              <Text accessibilityRole="header" className="text-foreground text-xl font-bold">
                {selectedPerson.isYou ? "You" : selectedPerson.name}
              </Text>
              <Text className="text-secondary text-sm">{selectedGroup.name}</Text>
            </View>
            <View className="gap-2 rounded-2xl bg-secondary/60 p-4">
              <Text
                className={cn(
                  "text-base font-semibold",
                  selectedPerson.onHold ? "text-warning-text" : "text-foreground",
                )}
              >
                {selectedPerson.onHold ? "On hold" : "Has room"}
              </Text>
              <Text className="text-tertiary text-sm leading-5">
                {selectedPerson.onHold
                  ? `${selectedPerson.isYou ? "Your phones don’t share your" : `${selectedPerson.name}’s phones don’t share their`} location in your groups, and can’t see anyone there, until you have room. To make room, remove someone from your groups.`
                  : `${selectedPerson.isYou ? "You count" : `${selectedPerson.name} counts`} as one person across all the groups you own, however many phones ${selectedPerson.isYou ? "you have" : "they have"}.`}
              </Text>
            </View>
            <Link
              href={{
                pathname: "/groups/[groupId]",
                params: { groupId: selectedGroup.id, tab: "members" },
              }}
              asChild
              onPress={() => setSelected(null)}
            >
              <Button>
                <Text>Open group</Text>
              </Button>
            </Link>
          </>
        ) : selectedGroup ? (
          <>
            <View className="gap-1">
              <Text accessibilityRole="header" className="text-foreground text-xl font-bold">
                {selectedGroup.name}
              </Text>
              <Text className="text-secondary text-sm">
                {selectedGroup.isOwner
                  ? "You own this group"
                  : `Owned by ${selectedGroup.owner.name}`}
              </Text>
            </View>
            {selectedGroup.youAreOnHold ? (
              <View className="gap-2 rounded-2xl bg-secondary/60 p-4">
                <Text className="text-warning-text text-base font-semibold">
                  You’re on hold here
                </Text>
                <Text className="text-tertiary text-sm leading-5">
                  Your phones don’t share your location in {selectedGroup.owner.name}’s groups, and
                  can’t see anyone there, until {selectedGroup.owner.name} has room for you. Sharing
                  starts again on its own when they do.
                </Text>
              </View>
            ) : (
              seats &&
              !selectedGroup.isOwner && (
                <Text className="text-tertiary text-sm leading-5">
                  This group uses {selectedGroup.owner.name}’s room for people, not yours.
                </Text>
              )
            )}
            <Link
              href={{ pathname: "/groups/[groupId]", params: { groupId: selectedGroup.id } }}
              asChild
              onPress={() => setSelected(null)}
            >
              <Button>
                <Text>Open group</Text>
              </Button>
            </Link>
          </>
        ) : null}
      </BottomSheet>
    </View>
  );
};

export default UsageScreen;
