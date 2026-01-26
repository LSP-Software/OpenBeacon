import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, queryClient } from "./client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, "../migrations");

export const runMigrations = async (): Promise<void> => {
  await migrate(db, { migrationsFolder });
  await queryClient.end();
};

if (import.meta.main) {
  runMigrations().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
