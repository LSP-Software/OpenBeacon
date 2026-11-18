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
import { authClient } from "../../lib/auth-client.ts";
import { cn } from "../../lib/cn.ts";
import { pluralize } from "../../lib/pluralize.ts";

const UsageScreen = () => {
  const isFocused = useIsFocused();
  const { data: session } = authClient.useSession();
  const [selected, setSelected] = useState<{ groupId: string; deviceId: string | null } | null>(
    null,
  );
  const usage = useQuery({
    ...trpc.account.usage.queryOptions(),
    staleTime: 0,
    subscribed: isFocused,
  });
  useAppForeground(() => {
    if (isFocused) void usage.refetch();
  });
  const formatDate = (date: Date) => date.toLocaleDateString(undefined, { dateStyle: "medium" });
  const seats = usage.data?.seats ?? null;
  const ownedGroups = usage.data?.groups.filter((group) => group.seats !== null) ?? [];
  const otherGroups = usage.data?.groups.filter((group) => group.seats === null) ?? [];
  const selectedGroup = usage.data?.groups.find((group) => group.id === selected?.groupId);
  const selectedPhone = selectedGroup?.seats?.phones.find(
    (phone) => phone.deviceId === selected?.deviceId,
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
              Each phone in a group you own takes one of your seats, including your own phones.
              Groups owned by someone else use their seats, not yours.
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

          {seats?.graceEndsAt && seats.paidPeriodEndsAt && (
            <View className="gap-2 rounded-2xl border border-warning-accent bg-card p-5">
              <Text className="text-foreground font-semibold">Your seats have ended</Text>
              <Text className="text-tertiary text-sm leading-5">
                Your paid period ended on {formatDate(seats.paidPeriodEndsAt)}. Your groups keep
                working until {formatDate(seats.graceEndsAt)}. Then the phones marked below go on
                hold until you renew.
              </Text>
            </View>
          )}

          {seats && seats.onHold > 0 && (
            <View className="gap-2 rounded-2xl border border-warning-accent bg-card p-5">
              <Text className="text-foreground font-semibold">
                {seats.onHold === 1 ? "1 phone is on hold" : `${seats.onHold} phones are on hold`}
              </Text>
              <Text className="text-tertiary text-sm leading-5">
                {seats.seats === 0
                  ? "Your account has no seats, so every phone in the groups you own is on hold."
                  : `You’re using more phones than your ${pluralize(seats.seats, "seat")}. The phones that took a seat last are on hold.`}{" "}
                A phone on hold doesn’t share its location in that group and can’t see anyone in it.
                To free a seat, remove someone from a group or remove one of your phones.
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
                      {pluralize(group.seats?.used ?? 0, "seat")}
                    </Text>
                  </View>
                  {group.seats?.phones.map((phone, index, phones) => (
                    <Pressable
                      key={phone.deviceId}
                      accessibilityRole="button"
                      onPress={() => setSelected({ groupId: group.id, deviceId: phone.deviceId })}
                      className={cn(
                        "flex-row items-center gap-3 px-5 py-3 active:bg-secondary/60",
                        index < phones.length - 1 && "border-b border-border/50",
                      )}
                    >
                      <View className="flex-1">
                        <Text className="text-foreground text-base">
                          {phone.memberName}
                          {phone.isThisPhone ? " (this phone)" : ""}
                        </Text>
                        <Text className="text-tertiary text-sm">{phone.deviceName}</Text>
                      </View>
                      {phone.onHold ? (
                        <Text className="text-warning-text text-sm font-medium">On hold</Text>
                      ) : phone.holdsFrom ? (
                        <Text className="text-warning-text text-sm">
                          On hold from {formatDate(phone.holdsFrom)}
                        </Text>
                      ) : null}
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
                    onPress={() => setSelected({ groupId: group.id, deviceId: null })}
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
                      {group.yourPhonesOnHold.length > 0 && (
                        <View className="mt-1 flex-row items-center gap-1.5">
                          <Icon as={CircleSlashIcon} className="size-4 text-warning-accent" />
                          <Text className="text-warning-text flex-1 text-sm">
                            {group.yourPhonesOnHold.length === 1 &&
                            group.yourPhonesOnHold[0]?.isThisPhone
                              ? "This phone is on hold here"
                              : `On hold here: ${group.yourPhonesOnHold.map(({ deviceName }) => deviceName).join(", ")}`}
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
          selectedGroup !== undefined &&
          (selected?.deviceId === null || selectedPhone !== undefined)
        }
        onClose={() => setSelected(null)}
        closeLabel="Close details"
      >
        {selectedGroup && selectedPhone ? (
          <>
            <View className="gap-1">
              <Text accessibilityRole="header" className="text-foreground text-xl font-bold">
                {selectedPhone.memberName}
                {selectedPhone.isThisPhone ? " (this phone)" : ""}
              </Text>
              <Text className="text-secondary text-sm">
                {selectedPhone.deviceName} · {selectedGroup.name}
              </Text>
            </View>
            <View className="gap-2 rounded-2xl bg-secondary/60 p-4">
              <Text
                className={cn(
                  "text-base font-semibold",
                  selectedPhone.onHold || selectedPhone.holdsFrom
                    ? "text-warning-text"
                    : "text-foreground",
                )}
              >
                {selectedPhone.onHold
                  ? "On hold"
                  : selectedPhone.holdsFrom
                    ? `On hold from ${formatDate(selectedPhone.holdsFrom)}`
                    : "Has a seat"}
              </Text>
              <Text className="text-tertiary text-sm leading-5">
                {selectedPhone.onHold
                  ? `This phone doesn’t share its location in ${selectedGroup.name} and can’t see anyone in it. To free a seat, remove someone from one of your groups or remove one of your own phones.`
                  : selectedPhone.holdsFrom
                    ? `Your seats have ended. This phone goes on hold in ${selectedGroup.name} on ${formatDate(selectedPhone.holdsFrom)} unless you renew. Removing someone from one of your groups or one of your own phones also frees a seat.`
                    : `This phone uses one of your seats in ${selectedGroup.name}.`}
              </Text>
            </View>
            <View className="gap-2">
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
              {selectedPhone.userId === session?.user.id && (
                <Link href="/account/devices" asChild onPress={() => setSelected(null)}>
                  <Button variant="secondary">
                    <Text>Your phones</Text>
                  </Button>
                </Link>
              )}
            </View>
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
            {selectedGroup.yourPhonesOnHold.length > 0 ? (
              <View className="gap-2 rounded-2xl bg-secondary/60 p-4">
                <Text className="text-warning-text text-base font-semibold">
                  On hold here:{" "}
                  {selectedGroup.yourPhonesOnHold
                    .map(
                      (phone) => `${phone.deviceName}${phone.isThisPhone ? " (this phone)" : ""}`,
                    )
                    .join(", ")}
                </Text>
                <Text className="text-tertiary text-sm leading-5">
                  A phone on hold doesn’t share its location in this group and can’t see anyone in
                  it. {selectedGroup.owner.name} needs a free seat for it to share again.
                </Text>
              </View>
            ) : (
              seats &&
              !selectedGroup.isOwner && (
                <Text className="text-tertiary text-sm leading-5">
                  This group uses {selectedGroup.owner.name}’s seats, not yours.
                </Text>
              )
            )}
            <View className="gap-2">
              <Link
                href={{ pathname: "/groups/[groupId]", params: { groupId: selectedGroup.id } }}
                asChild
                onPress={() => setSelected(null)}
              >
                <Button>
                  <Text>Open group</Text>
                </Button>
              </Link>
              {selectedGroup.yourPhonesOnHold.length > 0 && (
                <Link href="/account/devices" asChild onPress={() => setSelected(null)}>
                  <Button variant="secondary">
                    <Text>Your phones</Text>
                  </Button>
                </Link>
              )}
            </View>
          </>
        ) : null}
      </BottomSheet>
    </View>
  );
};

export default UsageScreen;
