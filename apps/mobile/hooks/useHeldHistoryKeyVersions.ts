import { useQuery } from "@tanstack/react-query";
import { getStoredHistoryKey } from "../lib/historyKeys.ts";

export const useHeldHistoryKeyVersions = (
  userId: string | undefined,
  currentVersion: number | undefined,
) =>
  useQuery({
    queryKey: ["historyKeyHeld", userId, currentVersion],
    enabled: Boolean(userId && currentVersion),
    queryFn: async () => {
      if (!userId || !currentVersion) return [];
      const versions = Array.from({ length: currentVersion }, (_, index) => index + 1);
      const held = await Promise.all(
        versions.map(async (version) => (await getStoredHistoryKey({ userId, version })) !== null),
      );
      return versions.filter((_, index) => held[index]);
    },
  });
