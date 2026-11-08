import type { OpenBeaconCache } from "@openbeacon/cache";
import { createSignedPmtilesUrl, resolvePmtilesArchiveKey } from "../r2.ts";

type ArchiveDependencies = {
  createSignedPmtilesUrl?: typeof createSignedPmtilesUrl;
  resolvePmtilesArchiveKey?: typeof resolvePmtilesArchiveKey;
};

export const PM_TILES_URL_REFRESH_WINDOW_MS = 60_000;

const buildPmtilesUrlPayload = ({
  archiveKey,
  expiresAt,
  url,
}: {
  archiveKey: string;
  expiresAt: string;
  url: string;
}) => {
  const expiresAtTimestamp = new Date(expiresAt).getTime();

  return {
    archiveKey,
    expiresAt,
    refreshAt: new Date(expiresAtTimestamp - PM_TILES_URL_REFRESH_WINDOW_MS).toISOString(),
    url,
  };
};

const canReusePmtilesSignedUrl = ({ expiresAt, now }: { expiresAt: string; now: number }) => {
  const expiresAtTimestamp = new Date(expiresAt).getTime();

  if (Number.isNaN(expiresAtTimestamp)) {
    return false;
  }

  return expiresAtTimestamp > now + PM_TILES_URL_REFRESH_WINDOW_MS;
};

const createAndCacheSignedPmtilesUrlForUser = async ({
  archiveKey,
  cache,
  createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
  source,
  userId,
}: {
  archiveKey: string;
  cache: OpenBeaconCache;
  createSignedPmtilesUrl: typeof createSignedPmtilesUrl | undefined;
  source: "forced" | "generated";
  userId: string;
}) => {
  const signer = createSignedPmtilesUrlOverride ?? createSignedPmtilesUrl;
  const signedPmtilesUrl = await signer(archiveKey);

  await cache.pmtilesSignedUrls.set({
    archiveKey,
    expiresAt: signedPmtilesUrl.expiresAt,
    url: signedPmtilesUrl.url,
    userId,
  });

  return {
    ...buildPmtilesUrlPayload(signedPmtilesUrl),
    source,
  };
};

export const getSignedPmtilesUrlForUser = async ({
  cache,
  createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
  now = Date.now,
  requestedArchiveKey,
  resolvePmtilesArchiveKey: resolvePmtilesArchiveKeyOverride,
  userId,
}: ArchiveDependencies & {
  cache: OpenBeaconCache;
  now?: () => number;
  requestedArchiveKey: string | undefined;
  userId: string;
}) => {
  const resolve = resolvePmtilesArchiveKeyOverride ?? resolvePmtilesArchiveKey;
  const archiveKey = await resolve(requestedArchiveKey);
  const cachedSignedPmtilesUrl = await cache.pmtilesSignedUrls.get({ archiveKey, userId });

  if (
    cachedSignedPmtilesUrl &&
    canReusePmtilesSignedUrl({ expiresAt: cachedSignedPmtilesUrl.expiresAt, now: now() })
  ) {
    return {
      ...buildPmtilesUrlPayload({ ...cachedSignedPmtilesUrl, archiveKey }),
      source: "cached" as const,
    };
  }

  return createAndCacheSignedPmtilesUrlForUser({
    archiveKey,
    cache,
    createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
    source: "generated",
    userId,
  });
};

export const forceRefreshSignedPmtilesUrlForUser = async ({
  cache,
  createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
  resolvePmtilesArchiveKey: resolvePmtilesArchiveKeyOverride,
  userId,
}: ArchiveDependencies & {
  cache: OpenBeaconCache;
  userId: string;
}) => {
  const resolve = resolvePmtilesArchiveKeyOverride ?? resolvePmtilesArchiveKey;

  return createAndCacheSignedPmtilesUrlForUser({
    archiveKey: await resolve(undefined),
    cache,
    createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
    source: "forced",
    userId,
  });
};
