import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/api.ts";
import { formatMapVersion } from "../lib/pmtilesUrl.ts";

export const useMapVersion = () => {
  const { data } = useQuery({ ...trpc.maps.getSignedPmtilesUrl.queryOptions(), enabled: false });

  return data?.archiveId
    ? formatMapVersion({ archiveId: data.archiveId, mapBuild: data.mapBuild ?? null })
    : undefined;
};
