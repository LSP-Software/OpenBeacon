import type { OpenBeaconCache } from "@openbeacon/cache";
import { createSignedPmtilesUrl } from "../r2.ts";

type CreateSignedPmtilesUrlFn = typeof createSignedPmtilesUrl;

export const PM_TILES_URL_REFRESH_WINDOW_MS = 60_000;

const buildPmtilesUrlPayload = ({ expiresAt, url }: { expiresAt: string; url: string }) => {
  const expiresAtTimestamp = new Date(expiresAt).getTime();

  return {
    expiresAt,
    refreshAt: new Date(expiresAtTimestamp - PM_TILES_URL_REFRESH_WINDOW_MS).toISOString(),
    url,
  };
};

const canReusePmtilesSignedUrl = ({
  expiresAt,
  now,
  url,
}: {
  expiresAt: string | null;
  now: number;
  url: string | null;
}) => {
  if (!url || !expiresAt) {
    return false;
  }

  const expiresAtTimestamp = new Date(expiresAt).getTime();

  if (Number.isNaN(expiresAtTimestamp)) {
    return false;
  }

  return expiresAtTimestamp > now + PM_TILES_URL_REFRESH_WINDOW_MS;
};

const createAndCacheSignedPmtilesUrlForUser = async ({
  cache,
  createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
  source,
  userId,
}: {
  cache: OpenBeaconCache;
  createSignedPmtilesUrl: CreateSignedPmtilesUrlFn | undefined;
  source: "forced" | "generated";
  userId: string;
}) => {
  const signer = createSignedPmtilesUrlOverride ?? createSignedPmtilesUrl;
  const signedPmtilesUrl = await signer();

  await cache.pmtilesSignedUrls.set({
    expiresAt: signedPmtilesUrl.expiresAt,
    url: signedPmtilesUrl.url,
    userId,
  });

  return {
    ...buildPmtilesUrlPayload({
      expiresAt: signedPmtilesUrl.expiresAt,
      url: signedPmtilesUrl.url,
    }),
    source,
  };
};

export const getSignedPmtilesUrlForUser = async ({
  cache,
  createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
  now = Date.now,
  userId,
}: {
  cache: OpenBeaconCache;
  createSignedPmtilesUrl?: typeof createSignedPmtilesUrl;
  now?: () => number;
  userId: string;
}) => {
  const cachedSignedPmtilesUrl = await cache.pmtilesSignedUrls.get({ userId });

  if (
    canReusePmtilesSignedUrl({
      expiresAt: cachedSignedPmtilesUrl?.expiresAt ?? null,
      now: now(),
      url: cachedSignedPmtilesUrl?.url ?? null,
    })
  ) {
    const expiresAt = cachedSignedPmtilesUrl?.expiresAt as string;
    const url = cachedSignedPmtilesUrl?.url as string;

    return {
      ...buildPmtilesUrlPayload({
        expiresAt,
        url,
      }),
      source: "cached" as const,
    };
  }

  return createAndCacheSignedPmtilesUrlForUser({
    cache,
    createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
    source: "generated",
    userId,
  });
};

export const forceRefreshSignedPmtilesUrlForUser = async ({
  cache,
  createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
  userId,
}: {
  cache: OpenBeaconCache;
  createSignedPmtilesUrl?: typeof createSignedPmtilesUrl;
  userId: string;
}) => {
  return createAndCacheSignedPmtilesUrlForUser({
    cache,
    createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
    source: "forced",
    userId,
  });
};
