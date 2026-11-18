import { skipToken, useQueries } from "@tanstack/react-query";
import { lookupAreaName } from "../lib/memberArea.ts";
import { useSignedPmtilesUrl } from "./useSignedPmtilesUrl.ts";

export const useAreaNames = (
  points: readonly { key: string; latitude: number; longitude: number }[],
) => {
  const signedPmtilesUrl = useSignedPmtilesUrl();
  const archiveId = signedPmtilesUrl.data?.archiveId ?? null;
  const url = signedPmtilesUrl.data?.url ?? null;
  const results = useQueries({
    queries: points.map((point) => ({
      queryKey: [
        "areaName",
        archiveId,
        point.latitude.toFixed(4),
        point.longitude.toFixed(4),
      ] as const,
      queryFn:
        archiveId && url
          ? () =>
              lookupAreaName({
                archiveId,
                point: { latitude: point.latitude, longitude: point.longitude },
                url,
              })
          : skipToken,
      retry: 1,
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
  return new Map(points.map((point, index) => [point.key, results[index]?.data ?? null]));
};
