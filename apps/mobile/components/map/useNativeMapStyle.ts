import { LogManager, TransformRequestManager } from "@maplibre/maplibre-react-native";
import { tryCatch } from "@openbeacon/shared";
import { useMutation } from "@tanstack/react-query";
import { Paths } from "expo-file-system";
import { router, useRootNavigationState } from "expo-router";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useSignedPmtilesUrl } from "../../hooks/useSignedPmtilesUrl.ts";
import { queryClient, trpc } from "../../lib/api.ts";
import {
  clearCachedMapTiles,
  prepareMapCache,
  readLastMapSource,
  saveLastMapSource,
} from "../../lib/mapCache.ts";
import {
  MAX_AUTO_FORCE_REFRESH_ATTEMPTS,
  nextMapLoadFailureState,
  shouldForceRefreshAfterMapLoadFailure,
} from "../../lib/mapPmtilesLoadFailure.ts";
import { getPmtilesSource, hasPmtilesArchiveChanged } from "../../lib/pmtilesUrl.ts";
import { getProtomapsMapStyle, getSymbolLayerIds } from "../../lib/protomaps-style.ts";
import { storage } from "../../lib/storage.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";

export const useNativeMapStyle = () => {
  const { mapTheme } = useTheme();
  const signedPmtilesUrlQuery = useSignedPmtilesUrl();
  const [lastMapSource] = useState(readLastMapSource);
  const [usingLastMapSource, setUsingLastMapSource] = useState(false);
  if (
    !usingLastMapSource &&
    (signedPmtilesUrlQuery.isPaused || signedPmtilesUrlQuery.failureCount > 0)
  ) {
    setUsingLastMapSource(true);
  }
  const autoForceRefreshAttemptsRef = useRef(0);
  const retryAfterUrlFetchRef = useRef(false);
  const mountedRef = useRef(false);
  const failedSourceRevisionRef = useRef<number | null>(null);
  const appliedArchiveIdRef = useRef<string | null>(lastMapSource?.archiveId ?? null);
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
  const applySignedUrl = ({ archiveId, url }: { archiveId: string | null; url: string }) => {
    const { find, sourceUrl } = getPmtilesSource({ archiveId, signedUrl: url });
    if (!sourceUrl) return;
    TransformRequestManager.addUrlTransform({
      id: `openbeacon-pmtiles:${sourceUrl}`,
      find,
      replace: url,
    });
    setArchiveUrl(sourceUrl);
    saveLastMapSource({ archiveId, sourceUrl });
  };
  const clearTilesIfArchiveChanged = (archiveId: string | null) => {
    const archiveChanged = hasPmtilesArchiveChanged({
      appliedArchiveId: appliedArchiveIdRef.current,
      archiveId,
    });
    appliedArchiveIdRef.current = archiveId;
    if (archiveChanged) void tryCatch(clearCachedMapTiles());
    return archiveChanged;
  };
  useEffect(() => {
    void tryCatch(prepareMapCache());
  }, []);
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
      clearTilesIfArchiveChanged(signedPmtilesUrl.archiveId ?? null);
      applySignedUrl({ archiveId: appliedArchiveIdRef.current, url: signedPmtilesUrl.url });
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
  const applyMapLoadFailureStateEvent = useEffectEvent(applyMapLoadFailureState);
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
        applyMapLoadFailureStateEvent(
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
  const pmtilesArchiveId = signedPmtilesUrlQuery.data?.archiveId ?? null;
  const applyQueriedSignedUrlEvent = useEffectEvent(
    ({ archiveId, url }: { archiveId: string | null; url: string }) => {
      const replacesLastMapSource =
        usingLastMapSource && archiveUrl === null && lastMapSource !== null;
      const archiveChanged = clearTilesIfArchiveChanged(archiveId);
      applySignedUrl({ archiveId, url });
      if (archiveChanged || replacesLastMapSource) setMapRevision((revision) => revision + 1);
    },
  );
  useEffect(() => {
    if (!pmtilesUrl) return;
    applyQueriedSignedUrlEvent({ archiveId: pmtilesArchiveId, url: pmtilesUrl });
  }, [pmtilesUrl, pmtilesArchiveId]);
  useEffect(() => {
    if (!archiveUrl) return;
    return () => TransformRequestManager.removeUrlTransform(`openbeacon-pmtiles:${archiveUrl}`);
  }, [archiveUrl]);
  const sourceUrl = archiveUrl ?? (usingLastMapSource ? (lastMapSource?.sourceUrl ?? null) : null);
  const mapStyle = useMemo(() => {
    if (!sourceUrl) {
      return null;
    }

    return getProtomapsMapStyle(
      mapTheme,
      sourceUrl,
      Platform.OS === "ios"
        ? `${Paths.bundle.uri}/map/fonts/{fontstack}/{range}.pbf`
        : "asset://map-assets/fonts/{fontstack}/{range}.pbf",
      Platform.OS === "ios" ? `${Paths.bundle.uri}/map/sprites` : "asset://map-assets/sprites",
      showSymbolsRef.current,
    );
  }, [mapTheme, sourceUrl]);
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

  const onMapLoadFailureEvent = useEffectEvent(onMapLoadFailure);
  const retryMapLoadEvent = useEffectEvent(retryMapLoad);

  useEffect(() => {
    if (signedPmtilesUrlQuery.isFetching || !retryAfterUrlFetchRef.current) return;
    retryAfterUrlFetchRef.current = false;
    onMapLoadFailureEvent();
  }, [signedPmtilesUrlQuery.isFetching]);

  useEffect(() => {
    if (
      !showRecoverableError ||
      forceRefreshSignedPmtilesUrlMutation.isPending ||
      signedPmtilesUrlQuery.isFetching
    ) {
      return;
    }

    const timer = setTimeout(() => retryMapLoadEvent(), 5_000);
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
    pmtilesUrl: sourceUrl,
    showSymbols,
    symbolLayerIds,
    showRecoverableError,
    isLoading: signedPmtilesUrlQuery.isLoading,
    isError: signedPmtilesUrlQuery.isError,
    isFetching: signedPmtilesUrlQuery.isFetching,
    isOffline: signedPmtilesUrlQuery.isPaused,
    isMapNotReady: signedPmtilesUrlQuery.failureReason?.data?.code === "SERVICE_UNAVAILABLE",
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
