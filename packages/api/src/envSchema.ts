import { forcePathStyleSchema, mapStorageEnvSchema, s3EndpointSchema } from "@openbeacon/map-tiles";
import { z } from "zod";

const publicEndpointSchema = (prefix: "IMAGES_S3" | "MAP_S3") =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    s3EndpointSchema(prefix).optional(),
  );

export const envSchema = {
  IMAGES_S3_ENDPOINT: s3EndpointSchema("IMAGES_S3"),
  IMAGES_S3_PUBLIC_ENDPOINT: publicEndpointSchema("IMAGES_S3"),
  IMAGES_S3_REGION: z.string().trim().min(1),
  IMAGES_S3_ACCESS_KEY_ID: z.string().trim().min(1),
  IMAGES_S3_ACCESS_KEY: z.string().trim().min(1),
  IMAGES_S3_BUCKET_NAME: z.string().trim().min(1),
  IMAGES_S3_FORCE_PATH_STYLE: forcePathStyleSchema,
  IMAGES_S3_CDN_URL: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, "")),
  MAX_IMAGE_FILE_SIZE: z.coerce.number().int().min(1).default(5242880),
  ...mapStorageEnvSchema,
  MAP_S3_PUBLIC_ENDPOINT: publicEndpointSchema("MAP_S3"),
};
