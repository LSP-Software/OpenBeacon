import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";
import { PrismaClient } from "../generated/client/client.ts";

const globalForPrisma = globalThis as {
  prisma?: PrismaClient;
};

export const createPrismaClient = (config: PoolConfig & { connectionString: string }) =>
  new PrismaClient({
    adapter: new PrismaPg({
      connectionTimeoutMillis: 10_000,
      statement_timeout: 30_000,
      ...config,
    }),
  });

const databaseUrl = process.env["DATABASE_URL"];

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const prisma = globalForPrisma.prisma ?? createPrismaClient({ connectionString: databaseUrl });

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.prisma = prisma;
}

export { prisma };
export default prisma;
