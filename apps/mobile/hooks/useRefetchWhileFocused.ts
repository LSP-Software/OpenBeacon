import { useIsFocused } from "@react-navigation/native";
import { focusManager, type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

export const useRefetchWhileFocused = (queryKeys: QueryKey[], intervalMs: number) => {
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const queryKeysRef = useRef(queryKeys);
  queryKeysRef.current = queryKeys;

  useEffect(() => {
    if (!isFocused) return;
    const timer = setInterval(() => {
      if (!focusManager.isFocused()) return;
      for (const queryKey of queryKeysRef.current) {
        void queryClient.refetchQueries({ queryKey, type: "active" }, { cancelRefetch: false });
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, isFocused, queryClient]);
};
