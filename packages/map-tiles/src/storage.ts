import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { getCurrentArchive } from "./manifest.ts";
import { readManifest } from "./manifestStore.ts";

export const forcePathStyleSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.stringbool().default(false),
);

export const mapStorageEnvSchema = {
  MAP_S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
  MAP_S3_REGION: z.string().min(1),
  MAP_S3_ACCESS_KEY_ID: z.string().min(1),
  MAP_S3_ACCESS_KEY: z.string().min(1),
  MAP_S3_BUCKET_NAME: z.string().min(1),
  MAP_S3_FORCE_PATH_STYLE: forcePathStyleSchema,
};

export const checkMapArchive = async ({ bucket, client }: { bucket: string; client: S3Client }) => {
  const stored = await readManifest({ bucket, client });

  if (!stored) {
    return;
  }

  await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: getCurrentArchive(stored.manifest).archive.key }),
    { abortSignal: AbortSignal.timeout(10_000) },
  );
};
