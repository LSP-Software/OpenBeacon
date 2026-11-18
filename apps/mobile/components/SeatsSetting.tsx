import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArmchairIcon, MinusIcon, PlusIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Alert } from "../lib/alert.ts";
import { trpc } from "../lib/api.ts";
import { Button } from "./ui/Button.tsx";
import { Icon } from "./ui/Icon.tsx";
import { Text } from "./ui/Text.tsx";

export const SeatsSetting = ({ subscribed }: { subscribed: boolean }) => {
  const queryClient = useQueryClient();
  const seats = useQuery({ ...trpc.account.seats.queryOptions(), subscribed });
  const setSeats = useMutation(trpc.account.setSeats.mutationOptions());
  const setPaidPeriodEnded = useMutation(trpc.account.setPaidPeriodEnded.mutationOptions());
  const [draft, setDraft] = useState<number | null>(null);
  if (!seats.data?.selfSetAllowed) return null;
  const { grace, max, paidPeriodEndsAt, paidSeats, used } = seats.data;
  const value = draft ?? paidSeats;
  const save = async () => {
    const result = await tryCatch(setSeats.mutateAsync({ seats: value }));
    if (result.error) {
      Alert.alert("Unable to change seats", result.error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: trpc.account.seats.queryKey() });
    setDraft(null);
  };
  const endPaidPeriod = async (ended: boolean) => {
    const result = await tryCatch(setPaidPeriodEnded.mutateAsync({ ended }));
    if (result.error) {
      Alert.alert("Unable to change the paid period", result.error.message);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.account.seats.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() }),
    ]);
  };
  const formatDate = (date: Date) =>
    date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const step = (by: number) => setDraft(Math.min(max, Math.max(0, value + by)));

  return (
    <View>
      <Text className="mb-1 text-lg font-medium text-muted-foreground">Beta testing</Text>
      <View className="gap-3 rounded-lg border border-border bg-card p-4">
        <View className="flex-row items-center gap-3">
          <Icon as={ArmchairIcon} className="size-6 text-muted-foreground" />
          <View className="flex-1">
            <Text className="font-medium">Seats (beta testing)</Text>
            <Text className="text-sm text-muted-foreground">
              Using {used} of {seats.data.seats}
              {seats.data.seats !== paidSeats ? ` (${paidSeats} paid)` : ""}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fewer seats"
            disabled={value === 0}
            onPress={() => step(-1)}
            className="size-10 items-center justify-center rounded-full bg-secondary"
          >
            <Icon as={MinusIcon} className="size-5 text-secondary-foreground" />
          </Pressable>
          <Text
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${value} seats`}
            className="w-12 text-center text-lg font-semibold"
          >
            {value}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More seats"
            disabled={value === max}
            onPress={() => step(1)}
            className="size-10 items-center justify-center rounded-full bg-secondary"
          >
            <Icon as={PlusIcon} className="size-5 text-secondary-foreground" />
          </Pressable>
        </View>
        {value !== paidSeats && (
          <Button size="sm" onPress={save} loading={setSeats.isPending}>
            <Text>Save {value} seats</Text>
          </Button>
        )}
        <View className="gap-2 border-t border-border pt-3">
          <Text className="text-sm text-muted-foreground">
            {paidPeriodEndsAt === null
              ? "Ending the paid period starts a 7-day grace period, at most once every 6 months. After it, this account has no seats, so every phone in the groups you own goes on hold."
              : grace
                ? `Your paid period ended ${formatDate(paidPeriodEndsAt)}. You keep your seats until ${formatDate(grace.endsAt)}.`
                : `Your paid period ended ${formatDate(paidPeriodEndsAt)} with no grace period left, so you have no seats.`}
          </Text>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => endPaidPeriod(paidPeriodEndsAt === null)}
            loading={setPaidPeriodEnded.isPending}
          >
            <Text>{paidPeriodEndsAt === null ? "End paid period now" : "Renew paid period"}</Text>
          </Button>
        </View>
      </View>
    </View>
  );
};
