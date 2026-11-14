import { forcePathStyleSchema, mapStorageEnvSchema } from "@openbeacon/map-tiles";
import { z } from "zod";

export const envSchema = {
  IMAGES_S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
  IMAGES_S3_REGION: z.string().min(1),
  IMAGES_S3_ACCESS_KEY_ID: z.string().min(1),
  IMAGES_S3_ACCESS_KEY: z.string().min(1),
  IMAGES_S3_BUCKET_NAME: z.string().min(1),
  IMAGES_S3_FORCE_PATH_STYLE: forcePathStyleSchema,
  IMAGES_S3_CDN_URL: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, "")),
  MAX_IMAGE_FILE_SIZE: z.coerce.number().int().min(1).default(5242880),
  ...mapStorageEnvSchema,
};
