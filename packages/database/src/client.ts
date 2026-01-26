import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env.js";
import { schema } from "./schema.js";

const connectionOptions = {
  max: env.DATABASE_MAX_CONNECTIONS,
  idle_timeout: env.DATABASE_IDLE_TIMEOUT_SECONDS,
  connect_timeout: env.DATABASE_CONNECT_TIMEOUT_SECONDS,
} as const;

const sslOptions = env.DATABASE_SSL ? { ssl: "require" as const } : {};

export const queryClient = postgres(env.DATABASE_URL, {
  ...connectionOptions,
  ...sslOptions,
});

export const db = drizzle(queryClient, { schema });

export type DatabaseClient = typeof db;
