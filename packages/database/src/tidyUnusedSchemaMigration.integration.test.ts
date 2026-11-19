import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { SQL } from "bun";

const migrationsPath = `${import.meta.dir}/../prisma/migrations`;
const target = "20261119011210_tidy_unused_schema";

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "tidy unused schema migration",
  () => {
    test("retired values are rewritten, creatorless invites are removed and unused columns go", async () => {
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
        INSERT INTO "User" ("id", "name", "email", "updatedAt") VALUES ('user', 'A', 'a@example.test', now());
        INSERT INTO "UserDevice" ("id", "userId", "publicKey", "publicKeyAlgorithm", "name", "icon", "activatedAt", "activatedBy") VALUES
          ('car', 'user', 'k1', 'X25519', 'Car', 'car', now(), 'existing'),
          ('home', 'user', 'k2', 'X25519', 'Home', 'home', NULL, NULL),
          ('star', 'user', 'k3', 'X25519', 'Star', 'star', now(), 'link');
        INSERT INTO "Group" ("id", "name", "updatedAt") VALUES ('group', 'Family', now());
        INSERT INTO "Feedback" ("id", "message", "userId") VALUES ('feedback', 'Hello', 'user');
        ALTER TABLE "GroupSharedInvite" DROP CONSTRAINT "GroupSharedInvite_creatorId_required";
        INSERT INTO "GroupSharedInvite" ("id", "codeHash", "groupId", "creatorId", "expiresAt") VALUES
          ('kept', 'a', 'group', 'user', now()),
          ('orphan', 'b', 'group', NULL, now());
        ALTER TABLE "GroupSharedInvite" ADD CONSTRAINT "GroupSharedInvite_creatorId_required" CHECK ("creatorId" IS NOT NULL) NOT VALID;
      `);

        await migrate(target);

        expect(
          await connection.unsafe(
            `SELECT "id", "icon"::text AS "icon", "activatedBy"::text AS "activatedBy", "activatedAt" IS NOT NULL AS "activated" FROM "UserDevice" ORDER BY "id"`,
          ),
        ).toEqual([
          { id: "car", icon: "phone", activatedBy: null, activated: true },
          { id: "home", icon: "phone", activatedBy: null, activated: false },
          { id: "star", icon: "star", activatedBy: "link", activated: true },
        ]);
        expect(
          await connection.unsafe(
            `SELECT t.typname AS "type", array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS "values" FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${schema}' AND t.typname IN ('DeviceIcon', 'DeviceActivation') GROUP BY t.typname ORDER BY t.typname`,
          ),
        ).toEqual([
          { type: "DeviceActivation", values: ["firstDevice", "link", "phrase", "reset"] },
          {
            type: "DeviceIcon",
            values: [
              "phone",
              "tablet",
              "phoneClassic",
              "tabletPortrait",
              "star",
              "heart",
              "flower",
              "sun",
            ],
          },
        ]);
        expect(await connection.unsafe(`SELECT "id" FROM "GroupSharedInvite"`)).toEqual([
          { id: "kept" },
        ]);
        expect(
          await connection.unsafe(
            `SELECT table_name AS "table", column_name AS "column", is_nullable AS "nullable" FROM information_schema.columns WHERE table_schema = '${schema}' AND ((table_name = 'Feedback' AND column_name = 'userId') OR (table_name = 'GroupSharedInvite' AND column_name = 'creatorId'))`,
          ),
        ).toEqual([{ table: "GroupSharedInvite", column: "creatorId", nullable: "NO" }]);
        expect(
          await connection.unsafe(
            `SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conname IN ('GroupSharedInvite_creatorId_required', 'Feedback_userId_fkey')`,
          ),
        ).toEqual([]);
        expect(
          await connection.unsafe(
            `SELECT indexname FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = 'GroupEpoch' ORDER BY indexname`,
          ),
        ).toEqual([
          { indexname: "GroupEpoch_createdAt_id_idx" },
          { indexname: "GroupEpoch_createdByDeviceId_idx" },
          { indexname: "GroupEpoch_groupId_epochNumber_key" },
          { indexname: "GroupEpoch_pkey" },
        ]);
      } finally {
        await connection.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        connection.release();
        await sql.close();
      }
    });
  },
);
