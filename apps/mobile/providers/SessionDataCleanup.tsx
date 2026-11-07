import { useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useEffect, useRef } from "react";
import { authClient } from "../lib/auth-client.ts";
import { clearGroupColors } from "../lib/groupColor.ts";
import { clearTrackingUploadTimes } from "../lib/trackingUploadTime.ts";

export const SessionDataCleanup = () => {
  const { data: session, isPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const previousUserIdRef = useRef<string | null | undefined>(undefined);
  const lastSessionCheckRef = useRef(0);
  const userId = session?.user.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useEffect(() => {
    if (isPending) return;
    const previousUserId = previousUserIdRef.current;
    previousUserIdRef.current = userId;
    const sessionEnded =
      previousUserId === undefined
        ? userId === null
        : !!previousUserId && previousUserId !== userId;
    if (!sessionEnded) return;
    queryClient.clear();
    clearGroupColors();
    clearTrackingUploadTimes();
  }, [isPending, queryClient, userId]);

  useEffect(() => {
    const checkSession = (error: unknown) => {
      if (!(error instanceof TRPCClientError) || error.data?.code !== "UNAUTHORIZED") return;
      if (!userIdRef.current || Date.now() - lastSessionCheckRef.current < 5_000) return;
      lastSessionCheckRef.current = Date.now();
      authClient.$store.notify("$sessionSignal");
    };
    const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error")
        checkSession(event.action.error);
    });
    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error")
        checkSession(event.action.error);
    });
    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
    };
  }, [queryClient]);

  return null;
};
