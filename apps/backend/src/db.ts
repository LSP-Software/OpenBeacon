import { prisma } from "@openbeacon/database";

export const db = prisma;
export type DatabaseClient = typeof db;
