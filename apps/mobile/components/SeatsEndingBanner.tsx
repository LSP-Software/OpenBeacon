import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { trpc } from "../lib/api.ts";
import { Text } from "./ui/Text.tsx";

export const SeatsEndingBanner = ({ subscribed }: { subscribed: boolean }) => {
  const seats = useQuery({ ...trpc.account.seats.queryOptions(), subscribed });
  const grace = seats.data?.grace;
  if (!grace || grace.holds.length === 0) return null;
  const endsAt = grace.endsAt.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const groupNames = [...new Set(grace.holds.map((hold) => hold.groupName))];

  return (
    <View className="mb-2 gap-2 rounded-xl border border-amber-600 dark:border-amber-400 bg-card p-4">
      <Text className="font-semibold text-amber-700 dark:text-amber-400">
        Your seats have ended
      </Text>
      <Text>
        Your groups keep working until {endsAt}. Then these phones go on hold until you renew your
        seats:
      </Text>
      {groupNames.map((groupName) => (
        <Text key={groupName}>
          <Text className="font-semibold">{groupName}: </Text>
          {grace.holds
            .filter((hold) => hold.groupName === groupName)
            .map((hold) => `${hold.memberName} (${hold.deviceName})`)
            .join(", ")}
        </Text>
      ))}
    </View>
  );
};
