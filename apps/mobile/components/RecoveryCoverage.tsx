import { ShieldCheckIcon } from "lucide-react-native";
import { useQueries, useQuery } from "@tanstack/react-query";
import { trpc, trpcClient } from "../lib/api.ts";
import { ensureDeviceKeyRegistration } from "../lib/deviceKeys.ts";
import { checkHistoryRecovery } from "../lib/groupKeyAccess.ts";
import { Text } from "./ui/Text.tsx";
import { ListRow, ListSection } from "./ui/List.tsx";

export const RecoveryCoverage = ({ userId }: { userId: string | undefined }) => {
  const groups = useQuery(trpc.groupMembership.list.queryOptions());
  const status = useQuery(trpc.accountRecovery.status.queryOptions());
  const groupList = groups.data ?? [];
  const historyKeyVersion = status.data?.currentHistoryKey?.version;
  const recovery = useQueries({
    queries: groupList.map(({ id: groupId }) => ({
      queryKey: ["groupKeyAccess", userId, groupId, "recovery", historyKeyVersion],
      enabled: Boolean(userId && historyKeyVersion !== undefined),
      staleTime: 5 * 60 * 1000,
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
    <ListSection title="Groups">
      {groupList.map((group, index) => {
        const groupRecovery = recovery[index];
        const result = groupRecovery?.data;
        return (
          <ListRow
            key={group.id}
            title={group.name}
            icon={ShieldCheckIcon}
            iconColor="green"
            subtitle={
              groupRecovery?.isError || status.isError
                ? "Unable to check this group."
                : status.data && historyKeyVersion === undefined
                  ? "History isn’t protected yet."
                  : !result
                    ? "Checking…"
                    : result.status === "complete"
                      ? "All history is protected."
                      : result.status === "none"
                        ? "History isn’t protected yet."
                        : `History from ${result.protectedFrom.toLocaleDateString(undefined, { dateStyle: "medium" })} is protected. Older history is protected once a phone that can still read it has your recovery phrase.`
            }
          />
        );
      })}
    </ListSection>
  );
};
