import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type MapTilesManifest, readManifest, resolveArchive } from "@openbeacon/map-tiles";
import { tryCatch } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import { env } from "./env.ts";
import { createStorageClient } from "./s3client.ts";

export const mapStorageClient = createStorageClient({
  endpoint: env.MAP_S3_ENDPOINT,
  region: env.MAP_S3_REGION,
  forcePathStyle: env.MAP_S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.MAP_S3_ACCESS_KEY_ID,
    secretAccessKey: env.MAP_S3_ACCESS_KEY,
  },
});

export const PM_TILES_URL_EXPIRES_IN_SECONDS = 60 * 10;
export const MAP_TILES_MANIFEST_CACHE_MS = 60_000;

export const createManifestCache = ({
  now = Date.now,
  read,
}: {
  now?: () => number;
  read: () => Promise<MapTilesManifest | null>;
}) => {
  let cached: { expiresAt: number; manifest: MapTilesManifest | null } | null = null;
  let pending: Promise<MapTilesManifest | null> | null = null;

  const refresh = async () => {
    const result = await tryCatch(read());

    if (result.error) {
      if (cached) {
        console.error("Could not refresh the map tiles manifest; serving the last known manifest");
        cached = { ...cached, expiresAt: now() + MAP_TILES_MANIFEST_CACHE_MS };
        return cached.manifest;
      }
      throw result.error;
    }

    cached = { expiresAt: now() + MAP_TILES_MANIFEST_CACHE_MS, manifest: result.data };
    return result.data;
  };

  return async () => {
    if (cached && now() < cached.expiresAt) {
      return cached.manifest;
    }

    pending ??= refresh().finally(() => {
      pending = null;
    });
    return pending;
  };
};

export const getMapTilesManifest = createManifestCache({
  read: async () =>
    (await readManifest({ bucket: env.MAP_S3_BUCKET_NAME, client: mapStorageClient }))?.manifest ??
    null,
});

export const resolvePmtilesArchive = async (requestedId: string | undefined) => {
  const manifest = await getMapTilesManifest();

  if (!manifest) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "The server is still preparing the map",
    });
  }

  const { archive, id, slot } = resolveArchive({ manifest, now: Date.now(), requestedId });
  return { build: archive.build, id, key: archive.key, slot };
};

export const createSignedPmtilesUrl = async (key: string) => {
  const command = new GetObjectCommand({
    Bucket: env.MAP_S3_BUCKET_NAME,
    Key: key,
  });

  const url = await getSignedUrl(mapStorageClient, command, {
    expiresIn: PM_TILES_URL_EXPIRES_IN_SECONDS,
  });

  const expiresAt = new Date(Date.now() + PM_TILES_URL_EXPIRES_IN_SECONDS * 1000).toISOString();

  return { url, expiresAt };
};
