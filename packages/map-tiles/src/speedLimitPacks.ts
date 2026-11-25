import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { tryCatch } from "@openbeacon/shared";
import { z } from "zod";

export const SPEED_LIMIT_PACKS_PUBLIC_URL = "https://cdn.openbeacon.net/speed-limits/";
export const SPEED_LIMIT_PACKS_MANIFEST_URL = `${SPEED_LIMIT_PACKS_PUBLIC_URL}manifest.json`;
export const SPEED_LIMIT_PACKS_MANIFEST_KEY = "speed-limits-manifest.json";
export const SPEED_LIMIT_PACKS_PREFIX = "speed-limits/";
export const RETIRED_PACK_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const regionIdSchema = z.string().regex(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/);
const publicPathSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9/_.-]*$/)
  .refine((path) => !path.split("/").includes(".."), { message: "must not leave the pack folder" });

const fileSchema = z.object({
  size: z.number().int().positive(),
  sha256: sha256Schema,
});

const regionSchema = fileSchema.extend({
  id: regionIdSchema,
  name: z.string().min(1),
  countryCode: z.string().regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

const licenceSchema = {
  format: z.literal(1),
  build: z.string().regex(/^\d{8}$/),
  publishedAt: z.iso.datetime(),
  license: z.string().min(1),
  licenseUrl: z.url(),
  attribution: z.string().min(1),
};

export const speedLimitPackManifestSchema = z
  .object({
    ...licenceSchema,
    boundaries: fileSchema.extend({ path: publicPathSchema }),
    regions: z.array(regionSchema.extend({ path: publicPathSchema })).min(1),
  })
  .loose()
  .refine(
    (manifest) => new Set(manifest.regions.map(({ id }) => id)).size === manifest.regions.length,
    {
      message: "Each region must appear once",
    },
  );

export const mirroredSpeedLimitPacksSchema = z
  .object({
    ...licenceSchema,
    mirroredAt: z.iso.datetime(),
    boundaries: fileSchema.extend({ key: z.string().min(1) }),
    regions: z.array(regionSchema.extend({ key: z.string().min(1) })),
    retired: z.array(z.object({ key: z.string().min(1), retiredAt: z.iso.datetime() })),
  })
  .loose();

export type SpeedLimitPackManifest = z.infer<typeof speedLimitPackManifestSchema>;
export type MirroredSpeedLimitPacks = z.infer<typeof mirroredSpeedLimitPacksSchema>;

export const getMirroredPackKey = ({ id, sha256 }: { id: string; sha256: string }) =>
  `${SPEED_LIMIT_PACKS_PREFIX}${id}-${sha256.slice(0, 16)}.obsl`;

export const getMirroredBoundariesKey = (sha256: string) =>
  `${SPEED_LIMIT_PACKS_PREFIX}boundaries-${sha256.slice(0, 16)}.json`;

export const readMirroredSpeedLimitPacks = async ({
  bucket,
  client,
}: {
  bucket: string;
  client: S3Client;
}) => {
  const result = await tryCatch(
    client.send(new GetObjectCommand({ Bucket: bucket, Key: SPEED_LIMIT_PACKS_MANIFEST_KEY }), {
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
    throw new Error("The speed limit pack manifest response is missing its body or ETag");
  }

  return {
    etag: result.data.ETag,
    manifest: mirroredSpeedLimitPacksSchema.parse(JSON.parse(body)),
  };
};

export const writeMirroredSpeedLimitPacks = async ({
  bucket,
  client,
  etag,
  manifest,
}: {
  bucket: string;
  client: S3Client;
  etag: string | null;
  manifest: MirroredSpeedLimitPacks;
}) => {
  const result = await tryCatch(
    client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: SPEED_LIMIT_PACKS_MANIFEST_KEY,
        Body: `${JSON.stringify(mirroredSpeedLimitPacksSchema.parse(manifest), null, 2)}\n`,
        CacheControl: "no-store",
        ContentType: "application/json",
        ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
      }),
    ),
  );

  if (result.error) {
    if (result.error.name === "PreconditionFailed") {
      throw new Error("The speed limit pack manifest changed while the mirror was running");
    }
    throw result.error;
  }
};
