import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { SQL } from "bun";

const migrationsPath = `${import.meta.dir}/../prisma/migrations`;
const target = "20261117112828_notification_settings";

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "notification settings migration",
  () => {
    test("existing email opt-outs become notification settings, and nothing else gets a row", async () => {
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
          INSERT INTO "User" ("id", "name", "email", "updatedAt", "alertNewSignIn", "alertDeletionScheduled") VALUES
            ('both-on', 'A', 'a@example.test', now(), true, true),
            ('sign-in-off', 'B', 'b@example.test', now(), false, true),
            ('deletion-off', 'C', 'c@example.test', now(), true, false),
            ('both-off', 'D', 'd@example.test', now(), false, false)
        `);

        await migrate(target);

        expect(
          await connection.unsafe(
            `SELECT "userId", "type"::text, "email", "phone" FROM "NotificationSetting" ORDER BY "userId", "type"`,
          ),
        ).toEqual([
          { userId: "both-off", type: "DELETION_SCHEDULED", email: false, phone: true },
          { userId: "both-off", type: "NEW_SIGN_IN", email: false, phone: true },
          { userId: "deletion-off", type: "DELETION_SCHEDULED", email: false, phone: true },
          { userId: "sign-in-off", type: "NEW_SIGN_IN", email: false, phone: true },
        ]);
        expect(
          await connection.unsafe(
            `SELECT column_name FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = 'User' AND column_name LIKE 'alert%'`,
          ),
        ).toEqual([]);
      } finally {
        await connection.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        connection.release();
        await sql.close();
      }
    });
  },
);
