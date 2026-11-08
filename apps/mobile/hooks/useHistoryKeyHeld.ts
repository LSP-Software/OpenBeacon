import { useQuery } from "@tanstack/react-query";
import { getStoredHistoryKey } from "../lib/historyKeys.ts";

export const useHistoryKeyHeld = (userId: string | undefined, version: number | undefined) =>
  useQuery({
    queryKey: ["historyKeyHeld", userId, version],
    enabled: Boolean(userId && version),
    queryFn: async () => {
      if (!userId || !version) return false;
      return (await getStoredHistoryKey({ userId, version })) !== null;
    },
  });
