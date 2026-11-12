import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type MapTilesManifest, readManifest, resolveArchive } from "@openbeacon/map-tiles";
import { tryCatch } from "@openbeacon/shared";
import { env } from "./env.ts";

export const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
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

const getMapTilesManifest = createManifestCache({
  read: async () =>
    (await readManifest({ bucket: env.R2_BUCKET, client: r2Client }))?.manifest ?? null,
});

export const resolvePmtilesArchive = async (requestedId: string | undefined) => {
  const manifest = await getMapTilesManifest();

  if (!manifest) {
    return { build: null, id: env.R2_PM_TILES_KEY, key: env.R2_PM_TILES_KEY, slot: null };
  }

  const { archive, id, slot } = resolveArchive({ manifest, now: Date.now(), requestedId });
  return { build: archive.build, id, key: archive.key, slot };
};

export const createSignedPmtilesUrl = async (key: string) => {
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
  });

  const url = await getSignedUrl(r2Client, command, {
    expiresIn: PM_TILES_URL_EXPIRES_IN_SECONDS,
  });

  const expiresAt = new Date(Date.now() + PM_TILES_URL_EXPIRES_IN_SECONDS * 1000).toISOString();

  return { url, expiresAt };
};
