import { useQuery } from "@tanstack/react-query";
import { checkStoredHistoryKey } from "../lib/currentHistoryKey.ts";
import { getStoredHistoryKey } from "../lib/historyKeys.ts";

export const useHeldHistoryKeyVersions = (
  userId: string | undefined,
  currentHistoryKey: { publicKey: string; version: number } | undefined,
) =>
  useQuery({
    queryKey: ["historyKeyHeld", userId, currentHistoryKey],
    enabled: Boolean(userId && currentHistoryKey),
    queryFn: async () => {
      if (!userId || !currentHistoryKey) return [];
      const versions = Array.from({ length: currentHistoryKey.version }, (_, index) => index + 1);
      const held = await Promise.all(
        versions.map(async (version) =>
          version === currentHistoryKey.version
            ? (await checkStoredHistoryKey({ ...currentHistoryKey, userId })).status === "held"
            : (await getStoredHistoryKey({ userId, version })) !== null,
        ),
      );
      return versions.filter((_, index) => held[index]);
    },
  });
