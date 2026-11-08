import { LogManager, TransformRequestManager } from "@maplibre/maplibre-react-native";
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
import { hasPmtilesArchiveChanged } from "../../lib/pmtilesUrl.ts";
import { getProtomapsMapStyle, getSymbolLayerIds } from "../../lib/protomaps-style.ts";
import { storage } from "../../lib/storage.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";

export const useNativeMapStyle = () => {
  const { mapTheme } = useTheme();
  const signedPmtilesUrlQuery = useSignedPmtilesUrl();
  const autoForceRefreshAttemptsRef = useRef(0);
  const retryAfterUrlFetchRef = useRef(false);
  const mountedRef = useRef(false);
  const failedSourceRevisionRef = useRef<number | null>(null);
  const appliedArchiveKeyRef = useRef<string | null>(null);
  const showRecoverableErrorRef = useRef(false);
  const [showRecoverableError, setShowRecoverableError] = useState(false);
  const [archiveUrl, setArchiveUrl] = useState<string | null>(null);
  const [mapRevision, setMapRevision] = useState(0);
  const mapRevisionRef = useRef(mapRevision);
  mapRevisionRef.current = mapRevision;
  const [showSymbols, setShowSymbols] = useState(
    () => storage.getBoolean("map.showSymbols") ?? true,
  );
  const showSymbolsRef = useRef(showSymbols);
  showSymbolsRef.current = showSymbols;
  const applyMapLoadFailureState = (next: {
    autoForceRefreshAttempts: number;
    showRecoverableError: boolean;
  }) => {
    autoForceRefreshAttemptsRef.current = next.autoForceRefreshAttempts;
    showRecoverableErrorRef.current = next.showRecoverableError;
    setShowRecoverableError(next.showRecoverableError);
  };
  const applySignedUrl = (url: string) => {
    const unsignedUrl = url.split("?")[0];
    if (!unsignedUrl) return;
    const escapedUrl = unsignedUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    TransformRequestManager.addUrlTransform({
      id: `openbeacon-pmtiles:${unsignedUrl}`,
      find: `^${escapedUrl}(?:\\?.*)?$`,
      replace: url,
    });
    setArchiveUrl(unsignedUrl);
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const forceRefreshSignedPmtilesUrlMutation = useMutation({
    ...trpc.maps.forceRefreshSignedPmtilesUrl.mutationOptions(),
    onSuccess: (signedPmtilesUrl) => {
      if (!mountedRef.current) return;
      appliedArchiveKeyRef.current = signedPmtilesUrl.archiveKey ?? null;
      applySignedUrl(signedPmtilesUrl.url);
      queryClient.setQueryData(trpc.maps.getSignedPmtilesUrl.queryKey(), signedPmtilesUrl);
      setMapRevision((revision) => revision + 1);
    },
    onError: () => {
      if (!mountedRef.current) return;
      applyMapLoadFailureState(
        nextMapLoadFailureState({
          autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
          event: "force_refresh_failed",
        }),
      );
    },
  });
  useEffect(() => {
    LogManager.onLog((log) => {
      if (
        log.level !== "error" ||
        !log.message.includes("Failed to load source protomaps") ||
        !log.message.includes("PMTiles")
      )
        return false;

      failedSourceRevisionRef.current = mapRevisionRef.current;
      if (!showRecoverableErrorRef.current) {
        applyMapLoadFailureState(
          nextMapLoadFailureState({
            autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
            event: "force_refresh_failed",
          }),
        );
      }
      return true;
    });
    return () => LogManager.onLog(() => false);
  }, []);
  const rootNavigationState = useRootNavigationState();
  const pmtilesUrl = signedPmtilesUrlQuery.data?.url ?? null;
  const pmtilesArchiveKey = signedPmtilesUrlQuery.data?.archiveKey ?? null;
  useEffect(() => {
    if (!pmtilesUrl) return;
    const archiveChanged = hasPmtilesArchiveChanged({
      appliedArchiveKey: appliedArchiveKeyRef.current,
      archiveKey: pmtilesArchiveKey,
    });
    appliedArchiveKeyRef.current = pmtilesArchiveKey;
    applySignedUrl(pmtilesUrl);
    if (archiveChanged) setMapRevision((revision) => revision + 1);
  }, [pmtilesUrl]);
  useEffect(() => {
    if (!archiveUrl) return;
    return () => TransformRequestManager.removeUrlTransform(`openbeacon-pmtiles:${archiveUrl}`);
  }, [archiveUrl]);
  const mapStyle = useMemo(() => {
    if (!archiveUrl) {
      return null;
    }

    return getProtomapsMapStyle(
      mapTheme,
      archiveUrl,
      Platform.OS === "ios"
        ? `${Paths.bundle.uri}/map/fonts/{fontstack}/{range}.pbf`
        : "asset://map-assets/fonts/{fontstack}/{range}.pbf",
      Platform.OS === "ios" ? `${Paths.bundle.uri}/map/sprites` : "asset://map-assets/sprites",
      showSymbolsRef.current,
    );
  }, [mapTheme, archiveUrl]);
  const symbolLayerIds = useMemo(() => (mapStyle ? getSymbolLayerIds(mapStyle) : []), [mapStyle]);

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
    if (signedPmtilesUrlQuery.isFetching && !forceRefreshSignedPmtilesUrlMutation.isPending) {
      retryAfterUrlFetchRef.current = true;
      return;
    }
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
    if (signedPmtilesUrlQuery.isFetching || !retryAfterUrlFetchRef.current) return;
    retryAfterUrlFetchRef.current = false;
    onMapLoadFailure();
  }, [signedPmtilesUrlQuery.isFetching]);

  useEffect(() => {
    if (
      !showRecoverableError ||
      forceRefreshSignedPmtilesUrlMutation.isPending ||
      signedPmtilesUrlQuery.isFetching
    ) {
      return;
    }

    const timer = setTimeout(retryMapLoad, 5_000);
    return () => clearTimeout(timer);
  }, [
    showRecoverableError,
    forceRefreshSignedPmtilesUrlMutation.isPending,
    signedPmtilesUrlQuery.isFetching,
  ]);

  useEffect(() => {
    if (!rootNavigationState?.key || signedPmtilesUrlQuery.error?.data?.code !== "UNAUTHORIZED") {
      return;
    }

    router.replace("/");
  }, [rootNavigationState?.key, signedPmtilesUrlQuery.error]);

  return {
    mapStyle,
    mapRevision,
    pmtilesUrl: archiveUrl,
    showSymbols,
    symbolLayerIds,
    showRecoverableError,
    isLoading: signedPmtilesUrlQuery.isLoading,
    isError: signedPmtilesUrlQuery.isError,
    isRefreshing: forceRefreshSignedPmtilesUrlMutation.isPending,
    retryUrl: () => {
      void signedPmtilesUrlQuery.refetch();
    },
    retryMapLoad,
    onMapLoadFailure,
    onStyleLoaded: () => {
      if (failedSourceRevisionRef.current === mapRevision) return;
      failedSourceRevisionRef.current = null;
      applyMapLoadFailureState(
        nextMapLoadFailureState({
          autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
          event: "style_loaded",
        }),
      );
    },
    toggleSymbols: () => {
      const next = !showSymbols;
      storage.set("map.showSymbols", next);
      setShowSymbols(next);
    },
  };
};
