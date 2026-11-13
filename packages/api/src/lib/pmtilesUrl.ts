import type { OpenBeaconCache } from "@openbeacon/cache";
import { errorCode, tryCatch } from "@openbeacon/shared";
import { createSignedPmtilesUrl, resolvePmtilesArchive } from "../r2.ts";

type ArchiveDependencies = {
  createSignedPmtilesUrl?: typeof createSignedPmtilesUrl;
  resolvePmtilesArchive?: typeof resolvePmtilesArchive;
};

type ResolvedArchive = Awaited<ReturnType<typeof resolvePmtilesArchive>>;

export const PM_TILES_URL_REFRESH_WINDOW_MS = 60_000;

const buildPmtilesUrlPayload = ({
  archive,
  expiresAt,
  url,
}: {
  archive: ResolvedArchive;
  expiresAt: string;
  url: string;
}) => {
  const expiresAtTimestamp = new Date(expiresAt).getTime();

  return {
    archiveId: archive.id,
    expiresAt,
    mapBuild: archive.build,
    mapSlot: archive.slot,
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
  archive,
  cache,
  createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
  source,
  userId,
}: {
  archive: ResolvedArchive;
  cache: OpenBeaconCache;
  createSignedPmtilesUrl: typeof createSignedPmtilesUrl | undefined;
  source: "forced" | "generated";
  userId: string;
}) => {
  const signer = createSignedPmtilesUrlOverride ?? createSignedPmtilesUrl;
  const signedPmtilesUrl = await signer(archive.key);

  const cached = await tryCatch(
    cache.pmtilesSignedUrls.set({
      archiveId: archive.id,
      expiresAt: signedPmtilesUrl.expiresAt,
      url: signedPmtilesUrl.url,
      userId,
    }),
  );
  if (cached.error) logCacheBypass(cached.error);

  return {
    ...buildPmtilesUrlPayload({ ...signedPmtilesUrl, archive }),
    key: archive.key,
    source,
  };
};

export const getSignedPmtilesUrlForUser = async ({
  cache,
  createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
  now = Date.now,
  requestedArchiveId,
  resolvePmtilesArchive: resolvePmtilesArchiveOverride,
  userId,
}: ArchiveDependencies & {
  cache: OpenBeaconCache;
  now?: () => number;
  requestedArchiveId: string | undefined;
  userId: string;
}) => {
  const archive = await (resolvePmtilesArchiveOverride ?? resolvePmtilesArchive)(
    requestedArchiveId,
  );
  const cachedResult = await tryCatch(
    cache.pmtilesSignedUrls.get({
      archiveId: archive.id,
      userId,
    }),
  );
  if (cachedResult.error) logCacheBypass(cachedResult.error);
  const cachedSignedPmtilesUrl = cachedResult.data;

  if (
    cachedSignedPmtilesUrl &&
    canReusePmtilesSignedUrl({ expiresAt: cachedSignedPmtilesUrl.expiresAt, now: now() })
  ) {
    return {
      ...buildPmtilesUrlPayload({ ...cachedSignedPmtilesUrl, archive }),
      key: archive.key,
      source: "cached" as const,
    };
  }

  return createAndCacheSignedPmtilesUrlForUser({
    archive,
    cache,
    createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
    source: "generated",
    userId,
  });
};

export const forceRefreshSignedPmtilesUrlForUser = async ({
  cache,
  createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
  resolvePmtilesArchive: resolvePmtilesArchiveOverride,
  userId,
}: ArchiveDependencies & {
  cache: OpenBeaconCache;
  userId: string;
}) =>
  createAndCacheSignedPmtilesUrlForUser({
    archive: await (resolvePmtilesArchiveOverride ?? resolvePmtilesArchive)(undefined),
    cache,
    createSignedPmtilesUrl: createSignedPmtilesUrlOverride,
    source: "forced",
    userId,
  });

const logCacheBypass = (error: Error) => {
  const code = errorCode(error);
  console.error(
    `[pmtiles] Redis is unavailable${code ? ` (${code})` : ""}, so the URL cache is bypassed`,
  );
};
