import { tryCatch } from "@openbeacon/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MinusIcon, PlusIcon, UsersIcon } from "lucide-react-native";
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
  seats: { seats: number; used: number; max: number };
  onChanged: () => Promise<unknown>;
}) => {
  const queryClient = useQueryClient();
  const setSeats = useMutation(trpc.account.setSeats.mutationOptions());
  const [draft, setDraft] = useState<number | null>(null);
  const { max, used } = seats;
  const value = draft ?? seats.seats;
  const save = async () => {
    const result = await tryCatch(setSeats.mutateAsync({ seats: value }));
    if (result.error) {
      Alert.alert("Unable to change your room for people", result.error.message);
      return;
    }
    await Promise.all([
      onChanged(),
      queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() }),
    ]);
    setDraft(null);
  };
  const step = (by: number) => setDraft(Math.min(max, Math.max(0, value + by)));

  return (
    <View>
      <Text variant="label" className="mb-2">
        Beta testing
      </Text>
      <View className="gap-3 rounded-2xl border border-border bg-card p-4">
        <View className="flex-row items-center gap-3">
          <Icon as={UsersIcon} className="size-6 text-tertiary" />
          <View className="flex-1">
            <Text className="font-medium">Room for people (beta testing)</Text>
            <Text className="text-sm text-tertiary">
              Using {used} of {seats.seats}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Room for fewer people"
            accessibilityState={{ disabled: value === 0 }}
            disabled={value === 0}
            onPress={() => step(-1)}
            className="size-11 items-center justify-center rounded-full bg-secondary disabled:opacity-50"
          >
            <Icon as={MinusIcon} className="size-5 text-secondary-foreground" />
          </Pressable>
          <Text
            accessibilityLiveRegion="polite"
            accessibilityLabel={pluralize(value, "person", "people")}
            className="w-12 text-center text-lg font-semibold"
          >
            {value}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Room for more people"
            accessibilityState={{ disabled: value === max }}
            disabled={value === max}
            onPress={() => step(1)}
            className="size-11 items-center justify-center rounded-full bg-secondary disabled:opacity-50"
          >
            <Icon as={PlusIcon} className="size-5 text-secondary-foreground" />
          </Pressable>
        </View>
        {value !== seats.seats && (
          <Button size="sm" onPress={save} loading={setSeats.isPending}>
            <Text>Save room for {pluralize(value, "person", "people")}</Text>
          </Button>
        )}
      </View>
    </View>
  );
};
