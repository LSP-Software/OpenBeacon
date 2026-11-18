import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { SQL } from "bun";

const migrationsPath = `${import.meta.dir}/../prisma/migrations`;
const target = "20261118021100_tracking_point_hours";

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "tracking point hours migration",
  () => {
    test("both hours are backfilled from when each point arrived and rows stay at 88 data bytes", async () => {
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
        INSERT INTO "UserDevice" ("id", "userId", "publicKey", "publicKeyAlgorithm", "name", "icon")
          VALUES ('device', 'user', 'key', 'X25519', 'Phone', 'phone');
        INSERT INTO "Group" ("id", "name", "updatedAt") VALUES ('group', 'Family', now());
        INSERT INTO "GroupEpoch" ("id", "groupId", "epochNumber", "createdByDeviceId", "senderPublicKey")
          VALUES ('epoch', 'group', 1, 'device', 'key');
        INSERT INTO "TrackingStream" ("id", "groupId", "epochId", "senderDeviceId", "senderUserId", "revisionPrefix")
          VALUES (1, 'group', 'epoch', 'device', 'user', '');
        INSERT INTO "TrackingPoint" ("streamId", "pointId", "receivedAt", "payload") VALUES
          (1, 1, '2026-11-17 23:59:59.999', '\\x01'),
          (1, 2, '2026-11-18 00:00:00', '\\x02'),
          (1, 3, '1970-01-01 01:30:00', '\\x03');
      `);

        await migrate(target);

        expect(
          await connection.unsafe(
            `SELECT "pointId"::int AS "pointId", "receivedHour", "capturedHour", encode("payload", 'hex') AS "payload" FROM "TrackingPoint" ORDER BY "pointId"`,
          ),
        ).toEqual([
          { pointId: 1, receivedHour: 498_599, capturedHour: 498_599, payload: "01" },
          { pointId: 2, receivedHour: 498_600, capturedHour: 498_600, payload: "02" },
          { pointId: 3, receivedHour: 1, capturedHour: 1, payload: "03" },
        ]);
        expect(
          await connection.unsafe(
            `SELECT indexname, regexp_replace(indexdef, '^.* USING ', '') AS "columns" FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = 'TrackingPoint' ORDER BY indexname`,
          ),
        ).toEqual([
          { indexname: "TrackingPoint_pkey", columns: 'btree ("streamId", "pointId")' },
          {
            indexname: "TrackingPoint_streamId_capturedHour_idx",
            columns: 'btree ("streamId", "capturedHour")',
          },
        ]);
        await connection.unsafe(`
        INSERT INTO "TrackingPoint" ("streamId", "pointId", "receivedHour", "capturedHour", "payload")
        VALUES (1, 4, 498600, 498600, decode(repeat('00', 63), 'hex'))
      `);
        expect(
          await connection.unsafe(
            `SELECT pg_column_size("point".*) - 24 AS "dataBytes" FROM "TrackingPoint" AS "point" WHERE "pointId" = 4`,
          ),
        ).toEqual([{ dataBytes: 88 }]);
        await connection.unsafe(`DELETE FROM "TrackingStream"`);
        expect(
          await connection.unsafe(`SELECT count(*)::int AS "count" FROM "TrackingPoint"`),
        ).toEqual([{ count: 0 }]);
      } finally {
        await connection.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        connection.release();
        await sql.close();
      }
    });
  },
);
