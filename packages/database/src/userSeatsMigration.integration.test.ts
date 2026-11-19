import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { SQL } from "bun";

const migrationsPath = `${import.meta.dir}/../prisma/migrations`;
const target = "20261118145758_user_seats";

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("user seats migration", () => {
  test("every existing account gets 2 seats", async () => {
    const schema = `migration_${crypto.randomUUID().replaceAll("-", "")}`;
    const sql = new SQL(process.env["DATABASE_URL"] ?? "");
    const connection = await sql.reserve();
    const migrate = async (name: string) =>
      connection.unsafe(await Bun.file(`${migrationsPath}/${name}/migration.sql`).text());
    try {
      await connection.unsafe(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`);
      const earlier = (await readdir(migrationsPath))
        .filter((name) => /^\d{14}_/.test(name) && name < target)
        .sort();
      for (const name of earlier) await migrate(name);
      await connection.unsafe(`
        INSERT INTO "User" ("id", "name", "email", "updatedAt") VALUES
          ('first', 'A', 'a@example.test', now()),
          ('second', 'B', 'b@example.test', now())
      `);

      await migrate(target);
      await connection.unsafe(
        `INSERT INTO "User" ("id", "name", "email", "updatedAt") VALUES ('new', 'C', 'c@example.test', now())`,
      );

      expect(await connection.unsafe(`SELECT "id", "seats" FROM "User" ORDER BY "id"`)).toEqual([
        { id: "first", seats: 2 },
        { id: "new", seats: 2 },
        { id: "second", seats: 2 },
      ]);
    } finally {
      await connection.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      connection.release();
      await sql.close();
    }
  });
});
