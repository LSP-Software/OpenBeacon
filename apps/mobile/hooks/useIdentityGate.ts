import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { trpc } from "../lib/api.ts";
import { identityGateDecision } from "../lib/identityGateDecision.ts";

export const useIdentityGate = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const queryClient = useQueryClient();
  const status = useQuery({
    ...trpc.accountRecovery.status.queryOptions(),
    enabled,
    refetchOnMount: "always",
  });
  const [decision, setDecision] = useState<"confirm" | "ready" | null>(null);

  useEffect(() => {
    if (decision === null && enabled && status.isFetchedAfterMount && !status.isFetching) {
      setDecision(identityGateDecision(status.isError ? undefined : status.data));
    }
  }, [
    decision,
    enabled,
    status.isFetchedAfterMount,
    status.isFetching,
    status.isError,
    status.data,
  ]);

  return {
    decision,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: trpc.accountRecovery.status.queryKey() }),
    recheck: async () => {
      const result = await status.refetch();
      setDecision(identityGateDecision(result.isError ? undefined : result.data));
    },
  };
};
