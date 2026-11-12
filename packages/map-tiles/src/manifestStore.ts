import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { tryCatch } from "@openbeacon/shared";
import {
  MAP_TILES_MANIFEST_KEY,
  type MapTilesManifest,
  mapTilesManifestSchema,
} from "./manifest.ts";

export const readManifest = async ({ bucket, client }: { bucket: string; client: S3Client }) => {
  const result = await tryCatch(
    client.send(new GetObjectCommand({ Bucket: bucket, Key: MAP_TILES_MANIFEST_KEY }), {
      abortSignal: AbortSignal.timeout(10_000),
    }),
  );

  if (result.error) {
    if (result.error.name === "NoSuchKey") {
      return null;
    }
    throw result.error;
  }

  const body = await result.data.Body?.transformToString();

  if (body === undefined || !result.data.ETag) {
    throw new Error("The map tiles manifest response is missing its body or ETag");
  }

  return {
    etag: result.data.ETag,
    manifest: mapTilesManifestSchema.parse(JSON.parse(body)),
  };
};

export const writeManifest = async ({
  bucket,
  client,
  etag,
  manifest,
}: {
  bucket: string;
  client: S3Client;
  etag: string | null;
  manifest: MapTilesManifest;
}) => {
  const result = await tryCatch(
    client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: MAP_TILES_MANIFEST_KEY,
        Body: `${JSON.stringify(mapTilesManifestSchema.parse(manifest), null, 2)}\n`,
        CacheControl: "no-store",
        ContentType: "application/json",
        ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
      }),
    ),
  );

  if (result.error) {
    if (result.error.name === "PreconditionFailed") {
      throw new Error("The map tiles manifest changed while this command was running; rerun it");
    }
    throw result.error;
  }

  return result.data.ETag ?? null;
};
