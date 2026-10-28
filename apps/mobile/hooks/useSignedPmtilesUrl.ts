import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { trpc } from "../lib/api.ts";
import { getPmtilesUrlRefreshDelayMs } from "../lib/pmtilesUrl.ts";

export const useSignedPmtilesUrl = () => {
  const query = useQuery({
    ...trpc.maps.getSignedPmtilesUrl.queryOptions(),
    retry: false,
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
