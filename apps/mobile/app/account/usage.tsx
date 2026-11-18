import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import { Link } from "expo-router";
import { ChevronRightIcon, PauseCircleIcon } from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackButton } from "../../components/headers/BackButton.tsx";
import { LoadingIndicator } from "../../components/LoadingIndicator.tsx";
import { SeatsSetting } from "../../components/SeatsSetting.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useAppForeground } from "../../hooks/useAppForeground.ts";
import { trpc } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";

const UsageScreen = () => {
  const isFocused = useIsFocused();
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

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="border-b border-border bg-background px-6 py-4">
        <View className="flex-row items-center justify-between">
          <BackButton />
          <Text className="text-foreground text-2xl font-bold">Usage</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      {!usage.data ? (
        <View className="flex-1 items-center justify-center gap-4 px-6">
          {usage.isError ? (
            <>
              <Text className="text-center text-muted-foreground">
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
          contentContainerClassName="gap-8 px-6 py-6 pb-32"
          showsVerticalScrollIndicator={false}
        >
          {seats && (
            <Text className="text-muted-foreground text-base leading-6">
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
                  className="gap-3 rounded-3xl border border-border bg-card p-5"
                >
                  <View className="flex-row items-baseline justify-between">
                    <Text className="text-foreground text-lg font-semibold">{gauge.label}</Text>
                    <Text className="text-muted-foreground text-base">
                      {gauge.used} of {gauge.max}{" "}
                      {gauge.max === 1 ? gauge.unit.one : gauge.unit.other}
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
                    <Text className="text-warning-accent text-sm font-medium">
                      {gauge.onHold} {gauge.onHold === 1 ? gauge.unit.one : gauge.unit.other} on
                      hold
                    </Text>
                  )}
                </View>
              );
            })}
          </View>

          {seats?.graceEndsAt && seats.paidPeriodEndsAt && (
            <View className="gap-2 rounded-3xl border border-warning-accent bg-card p-5">
              <Text className="text-foreground font-semibold">Your seats are ending</Text>
              <Text className="text-muted-foreground text-sm leading-5">
                Your paid period ended on {formatDate(seats.paidPeriodEndsAt)}. Your groups keep
                working until {formatDate(seats.graceEndsAt)}. Then the phones marked below go on
                hold until you renew.
              </Text>
            </View>
          )}

          {seats && seats.onHold > 0 && (
            <View className="gap-2 rounded-3xl border border-warning-accent bg-card p-5">
              <Text className="text-foreground font-semibold">
                {seats.onHold === 1 ? "1 phone is on hold" : `${seats.onHold} phones are on hold`}
              </Text>
              <Text className="text-muted-foreground text-sm leading-5">
                {seats.seats === 0
                  ? "Your account has no seats, so every phone in the groups you own is on hold."
                  : `You’re using more phones than your ${seats.seats} ${seats.seats === 1 ? "seat" : "seats"}. The phones that took a seat last are on hold.`}{" "}
                A phone on hold doesn’t share its location in that group and can’t see anyone in it.
                To free a seat, remove someone from a group or remove one of your phones. Tap a
                phone to see its group.
              </Text>
            </View>
          )}

          {seats?.selfSetAllowed && <SeatsSetting seats={seats} onChanged={usage.refetch} />}

          {ownedGroups.length > 0 && (
            <View className="gap-3">
              <Text className="text-foreground text-xl font-semibold">Groups you own</Text>
              {ownedGroups.map((group) => (
                <View
                  key={group.id}
                  className="overflow-hidden rounded-3xl border border-border bg-card"
                >
                  <View className="flex-row items-baseline justify-between border-b border-border/50 px-5 py-4">
                    <Text className="text-foreground flex-1 text-base font-semibold">
                      {group.name}
                    </Text>
                    <Text className="text-muted-foreground text-sm">
                      {group.seats?.used} {group.seats?.used === 1 ? "seat" : "seats"}
                    </Text>
                  </View>
                  {group.seats?.phones.map((phone, index, phones) => (
                    <Link
                      key={phone.deviceId}
                      href={{
                        pathname: "/groups/[groupId]",
                        params: { groupId: group.id, tab: "members" },
                      }}
                      asChild
                    >
                      <Pressable
                        accessibilityRole="link"
                        className={cn(
                          "flex-row items-center gap-3 px-5 py-3",
                          index < phones.length - 1 && "border-b border-border/50",
                        )}
                      >
                        <View className="flex-1">
                          <Text className="text-foreground text-base">
                            {phone.memberName}
                            {phone.isThisPhone ? " (this phone)" : ""}
                          </Text>
                          <Text className="text-muted-foreground text-sm">{phone.deviceName}</Text>
                        </View>
                        {phone.onHold ? (
                          <Text className="text-warning-accent text-sm font-medium">On hold</Text>
                        ) : phone.holdsFrom ? (
                          <Text className="text-warning-accent text-sm">
                            On hold from {formatDate(phone.holdsFrom)}
                          </Text>
                        ) : null}
                        <Icon as={ChevronRightIcon} className="size-4 text-muted-foreground" />
                      </Pressable>
                    </Link>
                  ))}
                </View>
              ))}
            </View>
          )}

          {otherGroups.length > 0 && (
            <View className="gap-3">
              <Text className="text-foreground text-xl font-semibold">
                {seats ? "Groups owned by others" : "Your groups"}
              </Text>
              <View className="overflow-hidden rounded-3xl border border-border bg-card">
                {otherGroups.map((group, index) => (
                  <Link
                    key={group.id}
                    href={{ pathname: "/groups/[groupId]", params: { groupId: group.id } }}
                    asChild
                  >
                    <Pressable
                      accessibilityRole="link"
                      className={cn(
                        "flex-row items-center gap-3 px-5 py-4",
                        index < otherGroups.length - 1 && "border-b border-border/50",
                      )}
                    >
                      <View className="flex-1 gap-0.5">
                        <Text className="text-foreground text-base font-medium">{group.name}</Text>
                        <Text className="text-muted-foreground text-sm">
                          {group.isOwner ? "You own this group" : `Owned by ${group.owner.name}`}
                        </Text>
                        {group.yourPhonesOnHold.length > 0 && (
                          <View className="mt-1 flex-row items-center gap-1.5">
                            <Icon as={PauseCircleIcon} className="size-4 text-warning-accent" />
                            <Text className="text-warning-accent flex-1 text-sm">
                              {group.yourPhonesOnHold.length === 1 &&
                              group.yourPhonesOnHold[0]?.isThisPhone
                                ? "This phone is on hold here"
                                : `On hold here: ${group.yourPhonesOnHold.map(({ deviceName }) => deviceName).join(", ")}`}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Icon as={ChevronRightIcon} className="size-4 text-muted-foreground" />
                    </Pressable>
                  </Link>
                ))}
              </View>
            </View>
          )}

          <View className="gap-3">
            <Text className="text-foreground text-xl font-semibold">Limits</Text>
            <View className="overflow-hidden rounded-3xl border border-border bg-card">
              {usage.data.limits.map((limit, index, limits) => (
                <View
                  key={limit.id}
                  className={cn(
                    "flex-row items-center justify-between px-5 py-4",
                    index < limits.length - 1 && "border-b border-border/50",
                  )}
                >
                  <Text className="text-foreground text-base">{limit.label}</Text>
                  <Text className="text-muted-foreground text-base">
                    {limit.value} {limit.value === 1 ? limit.unit.one : limit.unit.other}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
};

export default UsageScreen;
