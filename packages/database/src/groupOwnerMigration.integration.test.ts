import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { SQL } from "bun";

const migrationsPath = `${import.meta.dir}/../prisma/migrations`;
const target = "20261118154141_group_owner";

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("group owner migration", () => {
  test("each group's earliest-joined OWNER not being deleted becomes its owner, every role is renamed and owners get a seat for every person in their groups", async () => {
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
          ('dan', 'Dan', 'dan@example.test', now());
        INSERT INTO "User" ("id", "name", "email", "updatedAt", "seats") VALUES
          ('cat', 'Cat', 'cat@example.test', now(), 5);
        INSERT INTO "User" ("id", "name", "email", "updatedAt", "pendingDeletion") VALUES
          ('eve', 'Eve', 'eve@example.test', now(), true);
        INSERT INTO "Group" ("id", "name", "updatedAt") VALUES
          ('single', 'One owner', now()),
          ('several', 'Several owners', now()),
          ('empty', 'No members', now()),
          ('leaving', 'Owner leaving', now()),
          ('allLeaving', 'Every owner leaving', now()),
          ('benToo', 'Ben again', now());
        INSERT INTO "GroupMember" ("id", "userId", "groupId", "role", "joinedEpochNumber", "createdAt", "updatedAt") VALUES
          ('single-ann', 'ann', 'single', 'MEMBER', 1, '2026-01-01', now()),
          ('single-ben', 'ben', 'single', 'OWNER', 1, '2026-01-02', now()),
          ('single-cat', 'cat', 'single', 'ADMIN', 1, '2026-01-03', now()),
          ('several-ann', 'ann', 'several', 'OWNER', 1, '2026-02-03', now()),
          ('several-ben', 'ben', 'several', 'ADMIN', 1, '2026-02-01', now()),
          ('several-cat', 'cat', 'several', 'OWNER', 1, '2026-02-02', now()),
          ('several-dan', 'dan', 'several', 'MEMBER', 1, '2026-02-04', now()),
          ('leaving-eve', 'eve', 'leaving', 'OWNER', 1, '2026-03-01', now()),
          ('leaving-dan', 'dan', 'leaving', 'OWNER', 1, '2026-03-02', now()),
          ('allLeaving-eve', 'eve', 'allLeaving', 'OWNER', 1, '2026-04-01', now()),
          ('allLeaving-ann', 'ann', 'allLeaving', 'MEMBER', 1, '2026-04-02', now()),
          ('benToo-ben', 'ben', 'benToo', 'OWNER', 1, '2026-05-01', now()),
          ('benToo-ann', 'ann', 'benToo', 'MEMBER', 1, '2026-05-02', now()),
          ('benToo-dan', 'dan', 'benToo', 'MEMBER', 1, '2026-05-03', now());
        INSERT INTO "GroupEvent" ("id", "groupId", "type", "subjectUserId", "role") VALUES
          ('made-owner', 'several', 'ROLE_CHANGED', 'ann', 'OWNER'),
          ('made-admin', 'several', 'ROLE_CHANGED', 'ben', 'ADMIN');
        INSERT INTO "UserDevice" ("id", "userId", "publicKey", "publicKeyAlgorithm", "name", "icon", "activatedAt", "revokedAt") VALUES
          ('ann-phone', 'ann', 'key', 'x25519', 'Phone', 'phone', now(), NULL),
          ('ann-tablet', 'ann', 'key', 'x25519', 'Tablet', 'tablet', now(), NULL),
          ('ben-phone', 'ben', 'key', 'x25519', 'Phone', 'phone', now(), NULL),
          ('ben-old', 'ben', 'key', 'x25519', 'Old phone', 'phone', now(), now()),
          ('cat-phone', 'cat', 'key', 'x25519', 'Phone', 'phone', NULL, NULL),
          ('eve-phone', 'eve', 'key', 'x25519', 'Phone', 'phone', now(), NULL);
      `);

      await migrate(target);

      expect(await connection.unsafe(`SELECT "id", "ownerId" FROM "Group" ORDER BY "id"`)).toEqual([
        { id: "allLeaving", ownerId: "ann" },
        { id: "benToo", ownerId: "ben" },
        { id: "leaving", ownerId: "dan" },
        { id: "several", ownerId: "cat" },
        { id: "single", ownerId: "ben" },
      ]);
      expect(
        await connection.unsafe(`SELECT "id", "role" FROM "GroupMember" ORDER BY "id"`),
      ).toEqual([
        { id: "allLeaving-ann", role: "ADMIN" },
        { id: "allLeaving-eve", role: "ADMIN" },
        { id: "benToo-ann", role: "MEMBER" },
        { id: "benToo-ben", role: "ADMIN" },
        { id: "benToo-dan", role: "MEMBER" },
        { id: "leaving-dan", role: "ADMIN" },
        { id: "leaving-eve", role: "ADMIN" },
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
      expect(await connection.unsafe(`SELECT "id", "seats" FROM "User" ORDER BY "id"`)).toEqual([
        { id: "ann", seats: 2 },
        { id: "ben", seats: 4 },
        { id: "cat", seats: 5 },
        { id: "dan", seats: 2 },
        { id: "eve", seats: 2 },
      ]);
    } finally {
      await connection.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      connection.release();
      await sql.close();
    }
  });
});
