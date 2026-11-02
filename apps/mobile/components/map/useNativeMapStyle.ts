import { useMutation } from "@tanstack/react-query";
import { Paths } from "expo-file-system";
import { router, useRootNavigationState } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useSignedPmtilesUrl } from "../../hooks/useSignedPmtilesUrl.ts";
import { queryClient, trpc } from "../../lib/api.ts";
import {
  MAX_AUTO_FORCE_REFRESH_ATTEMPTS,
  nextMapLoadFailureState,
  shouldForceRefreshAfterMapLoadFailure,
} from "../../lib/mapPmtilesLoadFailure.ts";
import { getProtomapsMapStyle } from "../../lib/protomaps-style.ts";
import { storage } from "../../lib/storage.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";

export const useNativeMapStyle = () => {
  const { mapTheme } = useTheme();
  const signedPmtilesUrlQuery = useSignedPmtilesUrl();
  const autoForceRefreshAttemptsRef = useRef(0);
  const showRecoverableErrorRef = useRef(false);
  const [showRecoverableError, setShowRecoverableError] = useState(false);
  const [showSymbols, setShowSymbols] = useState(
    () => storage.getBoolean("map.showSymbols") ?? false,
  );
  const applyMapLoadFailureState = (next: {
    autoForceRefreshAttempts: number;
    showRecoverableError: boolean;
  }) => {
    autoForceRefreshAttemptsRef.current = next.autoForceRefreshAttempts;
    showRecoverableErrorRef.current = next.showRecoverableError;
    setShowRecoverableError(next.showRecoverableError);
  };
  const forceRefreshSignedPmtilesUrlMutation = useMutation({
    ...trpc.maps.forceRefreshSignedPmtilesUrl.mutationOptions(),
    onSuccess: (signedPmtilesUrl) => {
      queryClient.setQueryData(trpc.maps.getSignedPmtilesUrl.queryKey(), signedPmtilesUrl);
    },
    onError: () => {
      applyMapLoadFailureState(
        nextMapLoadFailureState({
          autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
          event: "force_refresh_failed",
        }),
      );
    },
  });
  const rootNavigationState = useRootNavigationState();
  const pmtilesUrl = signedPmtilesUrlQuery.data?.url ?? null;
  const mapStyle = useMemo(() => {
    if (!pmtilesUrl) {
      return null;
    }

    return getProtomapsMapStyle(
      mapTheme,
      pmtilesUrl,
      Platform.OS === "ios"
        ? `${Paths.bundle.uri}/map/fonts/{fontstack}/{range}.pbf`
        : "asset://map-assets/fonts/{fontstack}/{range}.pbf",
      Platform.OS === "ios" ? `${Paths.bundle.uri}/map/sprites` : "asset://map-assets/sprites",
      showSymbols,
    );
  }, [mapTheme, pmtilesUrl, showSymbols]);

  const retryMapLoad = () => {
    if (forceRefreshSignedPmtilesUrlMutation.isPending) {
      return;
    }

    applyMapLoadFailureState(
      nextMapLoadFailureState({
        autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
        event: "manual_retry",
      }),
    );
    applyMapLoadFailureState(
      nextMapLoadFailureState({
        autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
        event: "auto_force_refresh_started",
      }),
    );
    forceRefreshSignedPmtilesUrlMutation.mutate();
  };

  const onMapLoadFailure = () => {
    if (
      !shouldForceRefreshAfterMapLoadFailure({
        autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
        isForceRefreshPending: forceRefreshSignedPmtilesUrlMutation.isPending,
        isSignedUrlFetching: signedPmtilesUrlQuery.isFetching,
        showRecoverableError: showRecoverableErrorRef.current,
      })
    ) {
      if (
        !showRecoverableErrorRef.current &&
        !forceRefreshSignedPmtilesUrlMutation.isPending &&
        !signedPmtilesUrlQuery.isFetching &&
        autoForceRefreshAttemptsRef.current >= MAX_AUTO_FORCE_REFRESH_ATTEMPTS
      ) {
        applyMapLoadFailureState(
          nextMapLoadFailureState({
            autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
            event: "auto_retries_exhausted",
          }),
        );
      }
      return;
    }

    applyMapLoadFailureState(
      nextMapLoadFailureState({
        autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
        event: "auto_force_refresh_started",
      }),
    );
    forceRefreshSignedPmtilesUrlMutation.mutate();
  };

  useEffect(() => {
    if (!showRecoverableError || forceRefreshSignedPmtilesUrlMutation.isPending) {
      return;
    }

    const timer = setTimeout(retryMapLoad, 5_000);
    return () => clearTimeout(timer);
  }, [showRecoverableError, forceRefreshSignedPmtilesUrlMutation.isPending]);

  useEffect(() => {
    if (!rootNavigationState?.key || signedPmtilesUrlQuery.error?.data?.code !== "UNAUTHORIZED") {
      return;
    }

    router.replace("/");
  }, [rootNavigationState?.key, signedPmtilesUrlQuery.error]);

  return {
    mapStyle,
    pmtilesUrl,
    showSymbols,
    showRecoverableError,
    isLoading: signedPmtilesUrlQuery.isLoading,
    isError: signedPmtilesUrlQuery.isError,
    isRefreshing: forceRefreshSignedPmtilesUrlMutation.isPending,
    retryUrl: () => {
      void signedPmtilesUrlQuery.refetch();
    },
    retryMapLoad,
    onMapLoadFailure,
    onStyleLoaded: () =>
      applyMapLoadFailureState(
        nextMapLoadFailureState({
          autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
          event: "style_loaded",
        }),
      ),
    toggleSymbols: () => {
      const next = !showSymbols;
      storage.set("map.showSymbols", next);
      setShowSymbols(next);
    },
  };
};
