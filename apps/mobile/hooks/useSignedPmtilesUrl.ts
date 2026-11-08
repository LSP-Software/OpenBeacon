import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryClient, trpc, trpcClient } from "../lib/api.ts";
import { getPmtilesUrlRefreshDelayMs } from "../lib/pmtilesUrl.ts";

export const useSignedPmtilesUrl = () => {
  const queryOptions = trpc.maps.getSignedPmtilesUrl.queryOptions();
  const query = useQuery({
    ...queryOptions,
    queryFn: ({ signal }) =>
      trpcClient.maps.getSignedPmtilesUrl.query(
        { archiveKey: queryClient.getQueryData(queryOptions.queryKey)?.archiveKey },
        { signal },
      ),
    retry: (_failureCount, error) => error.data?.code !== "UNAUTHORIZED",
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
  });

  // Schedule the next refresh from refreshAt and refetch only, not the whole query object
  useEffect(() => {
    const refreshAt = query.data?.refreshAt;

    if (!refreshAt) {
      return;
    }

    const refreshInMs = getPmtilesUrlRefreshDelayMs({ refreshAt });

    if (refreshInMs === 0) {
      void query.refetch();
      return;
    }

    const timer = setTimeout(() => {
      void query.refetch();
    }, refreshInMs);

    return () => {
      clearTimeout(timer);
    };
  }, [query.data?.refreshAt, query.refetch]); // eslint-disable-line react-hooks/exhaustive-deps

  return query;
};
