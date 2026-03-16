import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { trpc } from "../lib/api.ts";

const PM_TILES_URL_REFRESH_BUFFER_MS = 60 * 1000;

export const useSignedPmtilesUrl = () => {
  const query = useQuery({
    ...trpc.maps.getSignedPmtilesUrl.queryOptions(),
    retry: false,
  });

  useEffect(() => {
    const expiresAt = query.data?.expiresAt;

    if (!expiresAt) {
      return;
    }

    const refreshInMs = Math.max(
      new Date(expiresAt).getTime() - Date.now() - PM_TILES_URL_REFRESH_BUFFER_MS,
      0,
    );

    const timer = setTimeout(() => {
      void query.refetch();
    }, refreshInMs);

    return () => {
      clearTimeout(timer);
    };
  }, [query.data?.expiresAt, query.refetch]);

  return query;
};
