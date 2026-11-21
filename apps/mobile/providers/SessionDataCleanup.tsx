import { tryCatch } from "@openbeacon/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router, useSegments } from "expo-router";
import { useEffect, useRef } from "react";
import { useAppForeground } from "../hooks/useAppForeground.ts";
import { authClient } from "../lib/auth-client.ts";
import { getBaseUrl } from "../lib/currentServer.ts";
import { clearGroupColors } from "../lib/groupColor.ts";
import { claimImageCache } from "../lib/imageCache.ts";
import { checkSessionAfterUnauthorized, isUnauthorizedError } from "../lib/sessionCheck.ts";
import { clearTrackingUploadTimes } from "../lib/trackingUploadTime.ts";

const signedOutScreens = new Set<string | undefined>([
  undefined,
  "(tabs)",
  "device-removed",
  "forgotPassword",
  "serverUrl",
  "signIn",
  "signUp",
]);

export const SessionDataCleanup = () => {
  const { data: session, isPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const screen: string | undefined = useSegments()[0];
  const screenRef = useRef(screen);
  const previousUserIdRef = useRef<string | null | undefined>(undefined);
  const lastResumeCheckRef = useRef(Date.now());
  const userId = session?.user.id ?? null;
  const userIdRef = useRef(userId);

  useEffect(() => {
    void tryCatch(
      import("../lib/historyExportFile.ts").then(({ clearHistoryExports }) =>
        clearHistoryExports(),
      ),
    );
    void tryCatch(
      import("../lib/recoveryPhrasePdf.ts").then(({ clearRecoveryPhrasePdfs }) =>
        clearRecoveryPhrasePdfs(),
      ),
    );
  }, []);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    if (isPending) return;
    void tryCatch(
      Promise.resolve().then(() =>
        claimImageCache(userId ? JSON.stringify([getBaseUrl(), userId]) : null),
      ),
    );
    void tryCatch(
      import("../lib/endSession.ts").then(({ settleLostSessions }) =>
        settleLostSessions({ userId }),
      ),
    );
    const previousUserId = previousUserIdRef.current;
    previousUserIdRef.current = userId;
    const sessionEnded =
      previousUserId === undefined
        ? userId === null
        : !!previousUserId && previousUserId !== userId;
    if (!sessionEnded) return;
    if (previousUserId && !userId && !signedOutScreens.has(screenRef.current))
      void tryCatch(Promise.resolve().then(() => router.replace("/")));
    queryClient.clear();
    clearGroupColors();
    clearTrackingUploadTimes();
    void tryCatch(import("../lib/mapCache.ts").then(({ clearSavedMap }) => clearSavedMap()));
    void tryCatch(
      import("../lib/notifications.ts").then(({ clearEventNotices }) =>
        clearEventNotices({ keepSecurityAlerts: true }),
      ),
    );
  }, [isPending, queryClient, userId]);

  useEffect(() => {
    const checkSession = (error: unknown) => {
      if (isUnauthorizedError(error) && userIdRef.current) checkSessionAfterUnauthorized();
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

  useAppForeground(() => {
    if (!userIdRef.current || Date.now() - lastResumeCheckRef.current < 60 * 60_000) return;
    lastResumeCheckRef.current = Date.now();
    authClient.$store.notify("$sessionSignal");
  });

  return null;
};
