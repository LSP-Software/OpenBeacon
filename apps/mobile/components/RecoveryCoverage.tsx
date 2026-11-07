import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { useGroupKeyAccess } from "../hooks/useGroupKeyAccess.ts";
import { trpc } from "../lib/api.ts";
import { Text } from "./ui/Text.tsx";

export const RecoveryCoverage = ({ userId }: { userId: string | undefined }) => {
  const groups = useQuery(trpc.groupMembership.list.queryOptions());
  const groupList = groups.data ?? [];
  const access = useGroupKeyAccess(
    groupList.map(({ id }) => id),
    userId,
  );

  if (groups.isError) return <Text>Unable to load your groups. Please try again.</Text>;
  if (groups.data && groupList.length === 0) {
    return <Text>History from groups you join will be protected automatically.</Text>;
  }

  return (
    <View className="gap-3">
      {groupList.map((group, index) => {
        const groupAccess = access[index];
        const history = groupAccess?.data?.history;
        return (
          <View key={group.id} className="gap-1 rounded-xl border border-border bg-card p-4">
            <Text className="font-semibold">{group.name}</Text>
            {groupAccess?.isError ? (
              <Text className="text-muted-foreground">Unable to check this group.</Text>
            ) : !history ? (
              <Text className="text-muted-foreground">Checking…</Text>
            ) : history === "complete" ? (
              <Text className="text-muted-foreground">All history is protected.</Text>
            ) : (
              <Text className="text-muted-foreground">
                History from{" "}
                {history.partialFrom.toLocaleDateString(undefined, { dateStyle: "medium" })} is
                protected. Earlier history was never on this phone, so it can’t be recovered.
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
};
