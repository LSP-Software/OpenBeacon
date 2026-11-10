import { useQueries, useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { trpc, trpcClient } from "../lib/api.ts";
import { ensureDeviceKeyRegistration } from "../lib/deviceKeys.ts";
import { checkHistoryRecovery } from "../lib/groupKeyAccess.ts";
import { Text } from "./ui/Text.tsx";

export const RecoveryCoverage = ({ userId }: { userId: string | undefined }) => {
  const groups = useQuery(trpc.groupMembership.list.queryOptions());
  const status = useQuery(trpc.accountRecovery.status.queryOptions());
  const groupList = groups.data ?? [];
  const historyKeyVersion = status.data?.currentHistoryKey?.version;
  const recovery = useQueries({
    queries: groupList.map(({ id: groupId }) => ({
      queryKey: ["groupKeyAccess", userId, groupId, "recovery", historyKeyVersion],
      enabled: Boolean(userId && historyKeyVersion !== undefined),
      staleTime: Infinity,
      queryFn: async () => {
        if (historyKeyVersion === undefined) throw new Error("History key is unavailable");
        const device = await ensureDeviceKeyRegistration();
        return checkHistoryRecovery({
          historyKeyVersion,
          listEpochs: (cursor: number | null) =>
            trpcClient.groupEpoch.listEpochKeyWraps.query({
              cursor,
              deviceId: device.deviceId,
              groupId,
            }),
        });
      },
    })),
  });

  if (groups.isError) return <Text>Unable to load your groups. Please try again.</Text>;
  if (groups.data && groupList.length === 0) return null;

  return (
    <View className="gap-3">
      {groupList.map((group, index) => {
        const groupRecovery = recovery[index];
        const result = groupRecovery?.data;
        return (
          <View key={group.id} className="gap-1 rounded-xl border border-border bg-card p-4">
            <Text className="font-semibold">{group.name}</Text>
            {groupRecovery?.isError || status.isError ? (
              <Text className="text-muted-foreground">Unable to check this group.</Text>
            ) : status.data && historyKeyVersion === undefined ? (
              <Text className="text-muted-foreground">History isn’t protected yet.</Text>
            ) : !result ? (
              <Text className="text-muted-foreground">Checking…</Text>
            ) : result.status === "complete" ? (
              <Text className="text-muted-foreground">All history is protected.</Text>
            ) : result.status === "none" ? (
              <Text className="text-muted-foreground">History isn’t protected yet.</Text>
            ) : (
              <Text className="text-muted-foreground">
                History from{" "}
                {result.protectedFrom.toLocaleDateString(undefined, { dateStyle: "medium" })} is
                protected. Older history is protected once a phone that can still read it has your
                recovery phrase.
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
};
