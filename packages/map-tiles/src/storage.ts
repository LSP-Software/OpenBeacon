import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { tryCatch } from "@openbeacon/shared";
import { z } from "zod";
import { getCurrentArchive } from "./manifest.ts";
import { readManifest } from "./manifestStore.ts";

export const forcePathStyleSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}, z.stringbool().default(false));

type StoragePrefix = "IMAGES_S3" | "MAP_S3";

export const s3EndpointSchema = (prefix: StoragePrefix) =>
  z.url({ protocol: /^https?$/ }).refine(
    (value) => {
      const url = URL.parse(value);
      return url === null || (url.pathname === "/" && url.search === "" && url.hash === "");
    },
    {
      message: `must be the S3 API address without a bucket or path; put the bucket name in ${prefix}_BUCKET_NAME`,
    },
  );

export const mapStorageEnvSchema = {
  MAP_S3_ENDPOINT: s3EndpointSchema("MAP_S3"),
  MAP_S3_REGION: z.string().trim().min(1),
  MAP_S3_ACCESS_KEY_ID: z.string().trim().min(1),
  MAP_S3_ACCESS_KEY: z.string().trim().min(1),
  MAP_S3_BUCKET_NAME: z.string().trim().min(1),
  MAP_S3_FORCE_PATH_STYLE: forcePathStyleSchema,
};

export const storageFailureHint = ({
  error,
  forcePathStyle,
  prefix,
}: {
  error: unknown;
  forcePathStyle: boolean;
  prefix: StoragePrefix;
}) => {
  if (!(error instanceof Error)) {
    return null;
  }

  const codes = [error.name, readField(error, "code"), readField(error, "Code")];
  const has = (...names: string[]) => names.some((name) => codes.includes(name));
  const metadata = readField(error, "$metadata");
  const status =
    typeof metadata === "object" && metadata !== null
      ? readField(metadata, "httpStatusCode")
      : undefined;
  const endpointHint = forcePathStyle
    ? `check ${prefix}_ENDPOINT`
    : `check ${prefix}_ENDPOINT, or set ${prefix}_FORCE_PATH_STYLE=true if your provider needs the bucket in the path`;

  if (has("ENOTFOUND", "EAI_AGAIN")) {
    return endpointHint;
  }
  if (has("ECONNREFUSED", "ECONNRESET", "ETIMEDOUT")) {
    return `check ${prefix}_ENDPOINT`;
  }
  if (has("NoSuchBucket")) {
    return `check ${prefix}_BUCKET_NAME`;
  }
  if (
    has(
      "AuthorizationHeaderMalformed",
      "PermanentRedirect",
      "IllegalLocationConstraintException",
      "InvalidRegion",
      "InvalidRegionName",
    ) ||
    status === 301
  ) {
    return `check ${prefix}_REGION`;
  }
  if (has("InvalidAccessKeyId", "SignatureDoesNotMatch")) {
    return `check ${prefix}_ACCESS_KEY_ID and ${prefix}_ACCESS_KEY`;
  }
  if (has("AccessDenied")) {
    return `the access key in ${prefix}_ACCESS_KEY_ID doesn't have permission to use the bucket`;
  }
  if (has("Forbidden") || status === 403) {
    return `check ${prefix}_ACCESS_KEY_ID and ${prefix}_ACCESS_KEY, and that the key has permission to use the bucket`;
  }
  if ((has("NotFound") || status === 404) && !forcePathStyle) {
    return endpointHint;
  }
  return null;
};

export const runStorageCheck = async ({
  check,
  forcePathStyle,
  label,
  prefix,
}: {
  check: () => Promise<unknown>;
  forcePathStyle: boolean;
  label: string;
  prefix: StoragePrefix;
}) => {
  const result = await tryCatch(check());

  if (result.error) {
    const hint = storageFailureHint({ error: result.error, forcePathStyle, prefix });
    if (hint) {
      console.error(`  ${label}: ${hint}`);
    }
    throw result.error;
  }
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

const readField = (value: object, key: string): unknown => Reflect.get(value, key);
