import { optionalEnvString, serverNameSchema } from "@openbeacon/schemas";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import type { EmailConfig } from "./types.ts";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const emailEnvSchema = {
  RESEND_API_KEY: optionalEnvString,
  SMTP_HOST: optionalEnvString,
  SMTP_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).optional()),
  SMTP_USER: optionalEnvString,
  SMTP_PASSWORD: optionalEnvString,
  SMTP_SECURE: z.preprocess(emptyToUndefined, z.stringbool().optional()),
  SMTP_REQUIRE_TLS: z.preprocess(emptyToUndefined, z.stringbool().optional()),
  EMAIL_FROM: optionalEnvString,
  EMAIL_CONSOLE: z.preprocess(emptyToUndefined, z.stringbool().default(false)),
  SERVER_NAME: serverNameSchema,
};

export const resolveEmailConfig = (
  env: z.output<z.ZodObject<typeof emailEnvSchema>> & { NODE_ENV: string | undefined },
): EmailConfig => {
  const hasSmtpSettings = [
    env.SMTP_PORT,
    env.SMTP_USER,
    env.SMTP_PASSWORD,
    env.SMTP_SECURE,
    env.SMTP_REQUIRE_TLS,
  ].some((value) => value !== undefined);
  if (env.RESEND_API_KEY && env.SMTP_HOST) {
    throw new Error("Set either RESEND_API_KEY or SMTP_HOST, not both");
  }
  if (hasSmtpSettings && !env.SMTP_HOST) {
    throw new Error("SMTP settings need SMTP_HOST");
  }
  if (env.EMAIL_CONSOLE && (env.RESEND_API_KEY || env.SMTP_HOST)) {
    throw new Error("EMAIL_CONSOLE cannot be combined with RESEND_API_KEY or SMTP_HOST");
  }
  if (env.EMAIL_FROM && !env.RESEND_API_KEY && !env.SMTP_HOST && !env.EMAIL_CONSOLE) {
    throw new Error("EMAIL_FROM needs RESEND_API_KEY or SMTP_HOST");
  }
  if (env.EMAIL_CONSOLE && env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    throw new Error("EMAIL_CONSOLE is only allowed when NODE_ENV is development or test");
  }

  const parseFrom = () => {
    const result = z.email().safeParse(env.EMAIL_FROM);
    if (!result.success) {
      throw new Error("EMAIL_FROM must be a valid email address when Resend or SMTP is configured");
    }
    return result.data;
  };

  if (env.EMAIL_CONSOLE) {
    return { transport: "console", fromAddress: env.EMAIL_FROM ?? "noreply@localhost" };
  }
  if (env.RESEND_API_KEY) {
    return { transport: "resend", fromAddress: parseFrom(), apiKey: env.RESEND_API_KEY };
  }
  if (!env.SMTP_HOST) return { transport: "none" };
  const fromAddress = parseFrom();
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must be set together");
  }
  const secure = env.SMTP_SECURE ?? env.SMTP_PORT === 465;
  return {
    transport: "smtp",
    fromAddress,
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? (secure ? 465 : 587),
    secure,
    requireTls: !secure && (env.SMTP_REQUIRE_TLS ?? true),
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : null,
  };
};

export const loadEmailSettings = () => {
  const env = createEnv({ server: emailEnvSchema, runtimeEnv: process.env });
  return {
    serverName: env.SERVER_NAME,
    config: resolveEmailConfig({ ...env, NODE_ENV: process.env["NODE_ENV"] }),
  };
};
