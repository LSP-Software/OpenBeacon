import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "./env.ts";

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
});

export const db = new PrismaClient({
  adapter,
});

export type DatabaseClient = PrismaClient;
