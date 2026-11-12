import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { getCurrentArchive } from "./manifest.ts";
import { readManifest } from "./manifestStore.ts";

export const r2EnvSchema = {
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
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
