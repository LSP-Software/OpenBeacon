import { createEnv } from "@t3-oss/env-core";
import { mapEnvSchema } from "./envSchema.ts";

export const mapEnv = createEnv({ server: mapEnvSchema, runtimeEnv: process.env });
