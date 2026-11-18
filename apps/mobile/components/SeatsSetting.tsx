import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArmchairIcon, MinusIcon, PlusIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Alert } from "../lib/alert.ts";
import { trpc } from "../lib/api.ts";
import { pluralize } from "../lib/pluralize.ts";
import { Button } from "./ui/Button.tsx";
import { Icon } from "./ui/Icon.tsx";
import { Text } from "./ui/Text.tsx";

export const SeatsSetting = ({
  seats,
  onChanged,
}: {
  seats: {
    seats: number;
    paidSeats: number;
    used: number;
    max: number;
    paidPeriodEndsAt: Date | null;
    graceEndsAt: Date | null;
  };
  onChanged: () => Promise<unknown>;
}) => {
  const queryClient = useQueryClient();
  const setSeats = useMutation(trpc.account.setSeats.mutationOptions());
  const setPaidPeriodEnded = useMutation(trpc.account.setPaidPeriodEnded.mutationOptions());
  const [draft, setDraft] = useState<number | null>(null);
  const { graceEndsAt, max, paidPeriodEndsAt, paidSeats, used } = seats;
  const value = draft ?? paidSeats;
  const refresh = () =>
    Promise.all([
      onChanged(),
      queryClient.invalidateQueries({ queryKey: trpc.account.seats.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() }),
    ]);
  const save = async () => {
    const result = await tryCatch(setSeats.mutateAsync({ seats: value }));
    if (result.error) {
      Alert.alert("Unable to change seats", result.error.message);
      return;
    }
    await refresh();
    setDraft(null);
  };
  const endPaidPeriod = async (ended: boolean) => {
    const result = await tryCatch(setPaidPeriodEnded.mutateAsync({ ended }));
    if (result.error) {
      Alert.alert("Unable to change the paid period", result.error.message);
      return;
    }
    await refresh();
  };
  const formatDate = (date: Date) =>
    date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const step = (by: number) => setDraft(Math.min(max, Math.max(0, value + by)));

  return (
    <View>
      <Text variant="label" className="mb-2">
        Beta testing
      </Text>
      <View className="gap-3 rounded-2xl border border-border bg-card p-4">
        <View className="flex-row items-center gap-3">
          <Icon as={ArmchairIcon} className="size-6 text-tertiary" />
          <View className="flex-1">
            <Text className="font-medium">Seats (beta testing)</Text>
            <Text className="text-sm text-tertiary">
              Using {used} of {seats.seats}
              {seats.seats !== paidSeats ? ` (${paidSeats} paid)` : ""}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fewer seats"
            accessibilityState={{ disabled: value === 0 }}
            disabled={value === 0}
            onPress={() => step(-1)}
            className="size-11 items-center justify-center rounded-full bg-secondary disabled:opacity-50"
          >
            <Icon as={MinusIcon} className="size-5 text-secondary-foreground" />
          </Pressable>
          <Text
            accessibilityLiveRegion="polite"
            accessibilityLabel={pluralize(value, "seat")}
            className="w-12 text-center text-lg font-semibold"
          >
            {value}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More seats"
            accessibilityState={{ disabled: value === max }}
            disabled={value === max}
            onPress={() => step(1)}
            className="size-11 items-center justify-center rounded-full bg-secondary disabled:opacity-50"
          >
            <Icon as={PlusIcon} className="size-5 text-secondary-foreground" />
          </Pressable>
        </View>
        {value !== paidSeats && (
          <Button size="sm" onPress={save} loading={setSeats.isPending}>
            <Text>Save {pluralize(value, "seat")}</Text>
          </Button>
        )}
        <View className="gap-2 border-t border-border pt-3">
          <Text className="text-sm text-tertiary">
            {paidPeriodEndsAt === null
              ? "Ending the paid period starts a 7-day grace period, at most once every 6 months. After it, this account has no seats, so every phone in the groups you own goes on hold."
              : graceEndsAt
                ? `Your paid period ended ${formatDate(paidPeriodEndsAt)}. You keep your seats until ${formatDate(graceEndsAt)}.`
                : `Your paid period ended ${formatDate(paidPeriodEndsAt)} with no grace period left, so you have no seats.`}
          </Text>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              if (paidPeriodEndsAt !== null) {
                void endPaidPeriod(false);
                return;
              }
              Alert.alert(
                "End the paid period now?",
                "This starts your 7-day grace period, which you can only use once every 6 months. When it ends, this account has no seats, so every phone in the groups you own goes on hold.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "End paid period",
                    style: "destructive",
                    onPress: () => void endPaidPeriod(true),
                  },
                ],
              );
            }}
            loading={setPaidPeriodEnded.isPending}
          >
            <Text>{paidPeriodEndsAt === null ? "End paid period now" : "Renew paid period"}</Text>
          </Button>
        </View>
      </View>
    </View>
  );
};
