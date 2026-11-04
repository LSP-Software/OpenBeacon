import { createEnv } from "@t3-oss/env-core";
import { envSchema } from "./envSchema.ts";

export const env = createEnv({ server: envSchema, runtimeEnv: process.env });
