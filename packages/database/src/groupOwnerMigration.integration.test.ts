import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { SQL } from "bun";

const migrationsPath = `${import.meta.dir}/../prisma/migrations`;
const target = "20261118154141_group_owner";

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("group owner migration", () => {
  test("each group's earliest-joined OWNER becomes its owner and every role is renamed", async () => {
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
          ('ann', 'Ann', 'ann@example.test', now()),
          ('ben', 'Ben', 'ben@example.test', now()),
          ('cat', 'Cat', 'cat@example.test', now()),
          ('dan', 'Dan', 'dan@example.test', now());
        INSERT INTO "Group" ("id", "name", "updatedAt") VALUES
          ('single', 'One owner', now()),
          ('several', 'Several owners', now()),
          ('empty', 'No members', now());
        INSERT INTO "GroupMember" ("id", "userId", "groupId", "role", "joinedEpochNumber", "createdAt", "updatedAt") VALUES
          ('single-ann', 'ann', 'single', 'MEMBER', 1, '2026-01-01', now()),
          ('single-ben', 'ben', 'single', 'OWNER', 1, '2026-01-02', now()),
          ('single-cat', 'cat', 'single', 'ADMIN', 1, '2026-01-03', now()),
          ('several-ann', 'ann', 'several', 'OWNER', 1, '2026-02-03', now()),
          ('several-ben', 'ben', 'several', 'ADMIN', 1, '2026-02-01', now()),
          ('several-cat', 'cat', 'several', 'OWNER', 1, '2026-02-02', now()),
          ('several-dan', 'dan', 'several', 'MEMBER', 1, '2026-02-04', now());
        INSERT INTO "GroupEvent" ("id", "groupId", "type", "subjectUserId", "role") VALUES
          ('made-owner', 'several', 'ROLE_CHANGED', 'ann', 'OWNER'),
          ('made-admin', 'several', 'ROLE_CHANGED', 'ben', 'ADMIN');
      `);

      await migrate(target);

      expect(await connection.unsafe(`SELECT "id", "ownerId" FROM "Group" ORDER BY "id"`)).toEqual([
        { id: "several", ownerId: "cat" },
        { id: "single", ownerId: "ben" },
      ]);
      expect(
        await connection.unsafe(`SELECT "id", "role" FROM "GroupMember" ORDER BY "id"`),
      ).toEqual([
        { id: "several-ann", role: "ADMIN" },
        { id: "several-ben", role: "EDITOR" },
        { id: "several-cat", role: "ADMIN" },
        { id: "several-dan", role: "MEMBER" },
        { id: "single-ann", role: "MEMBER" },
        { id: "single-ben", role: "ADMIN" },
        { id: "single-cat", role: "EDITOR" },
      ]);
      expect(
        await connection.unsafe(`SELECT "id", "role" FROM "GroupEvent" ORDER BY "id"`),
      ).toEqual([
        { id: "made-admin", role: "EDITOR" },
        { id: "made-owner", role: "ADMIN" },
      ]);
    } finally {
      await connection.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      connection.release();
      await sql.close();
    }
  });
});
