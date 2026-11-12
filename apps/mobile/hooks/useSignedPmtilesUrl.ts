import { useIsFocused } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient } from "../lib/api.ts";
import { getPmtilesUrlRefreshDelayMs } from "../lib/pmtilesUrl.ts";

export const useSignedPmtilesUrl = () => {
  const isFocused = useIsFocused();
  const queryOptions = trpc.maps.getSignedPmtilesUrl.queryOptions();

  return useQuery({
    ...queryOptions,
    queryFn: ({ signal }) =>
      trpcClient.maps.getSignedPmtilesUrl.query(
        { archiveId: queryClient.getQueryData(queryOptions.queryKey)?.archiveId },
        { signal },
      ),
    subscribed: isFocused,
    staleTime: ({ state }) =>
      state.data ? getPmtilesUrlRefreshDelayMs({ refreshAt: state.data.refreshAt }) : 0,
    refetchInterval: ({ state }) =>
      state.data
        ? Math.max(getPmtilesUrlRefreshDelayMs({ refreshAt: state.data.refreshAt }), 1_000)
        : false,
    retry: (_failureCount, error) => error.data?.code !== "UNAUTHORIZED",
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
  });
};
