import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trpc } from "../lib/api.ts";

export const useIdentityGate = () => {
  const queryClient = useQueryClient();
  const status = useQuery(trpc.accountRecovery.status.queryOptions());
  return {
    loading: status.isPending,
    needsConfirmation: status.data?.sessionFresh !== true,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: trpc.accountRecovery.status.queryKey() }),
  };
};
