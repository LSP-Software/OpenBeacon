import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/api.ts";

export const useCachedGroup = (groupId: string) => {
  const { data, isPending } = useQuery({
    ...trpc.groupMembership.list.queryOptions(),
    staleTime: Infinity,
    select: (groups) => ({
      group: groups.find((item) => item.id === groupId),
      groupCount: groups.length,
    }),
  });
  return {
    group: data?.group,
    groupCount: data?.groupCount ?? 0,
    isPending,
    isMissing: data !== undefined && data.group === undefined,
  };
};
