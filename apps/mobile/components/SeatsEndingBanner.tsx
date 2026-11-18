import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { View } from "react-native";
import { trpc } from "../lib/api.ts";
import { pluralize } from "../lib/pluralize.ts";
import { Button } from "./ui/Button.tsx";
import { Text } from "./ui/Text.tsx";

export const SeatsEndingBanner = ({ subscribed }: { subscribed: boolean }) => {
  const seats = useQuery({ ...trpc.account.seats.queryOptions(), subscribed });
  const grace = seats.data?.grace;
  if (!grace || grace.holds.length === 0) return null;
  const endsAt = grace.endsAt.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <View className="mb-2 gap-2 rounded-2xl border border-warning-accent bg-card p-4">
      <Text className="font-semibold text-warning-text">Your seats have ended</Text>
      <Text>
        {pluralize(grace.holds.length, "phone")} in your groups{" "}
        {grace.holds.length === 1 ? "goes" : "go"} on hold on {endsAt} unless you renew your seats.
      </Text>
      <Link href="/account/usage" asChild>
        <Button size="sm" className="self-start">
          <Text>See usage</Text>
        </Button>
      </Link>
    </View>
  );
};
