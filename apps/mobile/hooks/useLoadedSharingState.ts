import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { trpc } from "../lib/api.ts";
import { onSharingStateLoaded } from "../lib/locationSharing.ts";

export const useLoadedSharingState = () => {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onSharingStateLoaded((state) =>
        queryClient.setQueryData(trpc.account.locationSharing.queryKey(), (current) =>
          current && current.serverTime > state.serverTime ? current : state,
        ),
      ),
    [queryClient],
  );
};
