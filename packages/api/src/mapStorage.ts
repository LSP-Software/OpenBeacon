import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  checkMapArchive,
  type MapTilesManifest,
  readManifest,
  resolveArchive,
  runStorageCheck,
} from "@openbeacon/map-tiles";
import { tryCatch } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import { mapEnv } from "./mapEnv.ts";
import { createStorageClient } from "./s3client.ts";

const mapConfig = {
  region: mapEnv.MAP_S3_REGION,
  forcePathStyle: mapEnv.MAP_S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: mapEnv.MAP_S3_ACCESS_KEY_ID,
    secretAccessKey: mapEnv.MAP_S3_ACCESS_KEY,
  },
};

export const mapStorageClient = createStorageClient({
  ...mapConfig,
  endpoint: mapEnv.MAP_S3_ENDPOINT,
});

const mapStoragePresignClient = mapEnv.MAP_S3_PUBLIC_ENDPOINT
  ? createStorageClient({ ...mapConfig, endpoint: mapEnv.MAP_S3_PUBLIC_ENDPOINT })
  : mapStorageClient;

export const checkMapStorage = () =>
  runStorageCheck({
    label: "Map storage",
    prefix: "MAP_S3",
    forcePathStyle: mapEnv.MAP_S3_FORCE_PATH_STYLE,
    check: () => checkMapArchive({ bucket: mapEnv.MAP_S3_BUCKET_NAME, client: mapStorageClient }),
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
    (await readManifest({ bucket: mapEnv.MAP_S3_BUCKET_NAME, client: mapStorageClient }))
      ?.manifest ?? null,
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
    Bucket: mapEnv.MAP_S3_BUCKET_NAME,
    Key: key,
    ResponseCacheControl: "private, max-age=31536000, immutable",
  });

  const url = await getSignedUrl(mapStoragePresignClient, command, {
    expiresIn: PM_TILES_URL_EXPIRES_IN_SECONDS,
  });

  const expiresAt = new Date(Date.now() + PM_TILES_URL_EXPIRES_IN_SECONDS * 1000).toISOString();

  return { url, expiresAt };
};
