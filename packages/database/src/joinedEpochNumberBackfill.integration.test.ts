import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { Client } from "pg";

setDefaultTimeout(60_000);

const migrationsUrl = new URL("../prisma/migrations/", import.meta.url);
const backfillMigration = "20261107210941_recovery_history_keys";
const databaseName = `openbeacon_migration_${crypto.randomUUID().replaceAll("-", "")}`;
const joinedEpochNumbers = new Map<string, number>();

const connect = async (database?: string) => {
  const url = new URL(process.env["DATABASE_URL"] ?? "");
  if (database) url.pathname = `/${database}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return client;
};

const applyMigrations = async (client: Client, names: string[]) => {
  for (const name of names) {
    await client.query(await Bun.file(new URL(`${name}/migration.sql`, migrationsUrl)).text());
  }
};

const at = (hours: number) => new Date(Date.UTC(2026, 10, 1, hours));

const seed = async (client: Client) => {
  const users = ["alice", "bob", "carol", "dave", "erin", "frank"];
  for (const id of users) {
    await client.query(
      `INSERT INTO "User" (id, name, email, "updatedAt") VALUES ($1, $1, $1 || '@example.test', now())`,
      [id],
    );
  }
  for (const id of ["alice", "bob", "carol", "erin"]) {
    await client.query(
      `INSERT INTO "UserDevice" (id, "userId", "publicKey", "publicKeyAlgorithm") VALUES ($1, $2, 'key', 'x25519')`,
      [`${id}-device`, id],
    );
  }
  for (const id of ["rejoin", "other", "empty"]) {
    await client.query(`INSERT INTO "Group" (id, name, "updatedAt") VALUES ($1, $1, now())`, [id]);
  }

  const epochs: Array<{ groupId: string; epochNumber: number; recipients: string[] }> = [
    { groupId: "rejoin", epochNumber: 1, recipients: ["alice"] },
    { groupId: "rejoin", epochNumber: 2, recipients: ["alice", "bob"] },
    { groupId: "rejoin", epochNumber: 3, recipients: ["alice", "carol"] },
    { groupId: "rejoin", epochNumber: 4, recipients: ["alice", "bob", "carol"] },
    { groupId: "other", epochNumber: 1, recipients: ["erin"] },
    { groupId: "other", epochNumber: 2, recipients: ["erin"] },
  ];
  for (const { groupId, epochNumber, recipients } of epochs) {
    const epochId = `${groupId}-epoch-${epochNumber}`;
    await client.query(
      `INSERT INTO "GroupEpoch" (id, "groupId", "epochNumber", "senderPublicKey", "createdAt") VALUES ($1, $2, $3, 'key', $4)`,
      [epochId, groupId, epochNumber, at(epochNumber)],
    );
    for (const recipient of recipients) {
      await client.query(
        `INSERT INTO "GroupEpochRecipientKey" (id, "groupEpochId", "recipientDeviceId", "wrappedKey", "ephemeralPublicKey", algorithm) VALUES ($1, $2, $3, 'wrapped', 'ephemeral', 'x25519')`,
        [`${epochId}-${recipient}`, epochId, `${recipient}-device`],
      );
    }
  }

  const members: Array<{ groupId: string; userId: string; joinedAtHour: number }> = [
    { groupId: "rejoin", userId: "alice", joinedAtHour: 0 },
    { groupId: "rejoin", userId: "carol", joinedAtHour: 2.5 },
    { groupId: "rejoin", userId: "bob", joinedAtHour: 3.5 },
    { groupId: "rejoin", userId: "dave", joinedAtHour: 4.5 },
    { groupId: "rejoin", userId: "erin", joinedAtHour: 4.5 },
    { groupId: "other", userId: "erin", joinedAtHour: 0 },
    { groupId: "empty", userId: "frank", joinedAtHour: 0 },
  ];
  for (const { groupId, userId, joinedAtHour } of members) {
    await client.query(
      `INSERT INTO "GroupMember" (id, "userId", "groupId", role, "createdAt", "updatedAt") VALUES ($1, $2, $3, 'MEMBER', $4, $4)`,
      [
        `${groupId}-${userId}`,
        userId,
        groupId,
        new Date(at(0).getTime() + joinedAtHour * 3_600_000),
      ],
    );
  }
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "joinedEpochNumber backfill migration",
  () => {
    beforeAll(async () => {
      const admin = await connect();
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      await admin.end();

      const migrations = (await readdir(migrationsUrl, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map(({ name }) => name)
        .sort();
      const backfillIndex = migrations.indexOf(backfillMigration);
      expect(backfillIndex).toBeGreaterThan(0);

      const client = await connect(databaseName);
      await applyMigrations(client, migrations.slice(0, backfillIndex));
      await seed(client);
      await applyMigrations(client, migrations.slice(backfillIndex));
      const { rows } = await client.query<{ id: string; joinedEpochNumber: number }>(
        `SELECT id, "joinedEpochNumber" FROM "GroupMember"`,
      );
      await client.end();
      for (const { id, joinedEpochNumber } of rows) joinedEpochNumbers.set(id, joinedEpochNumber);
    });

    afterAll(async () => {
      const admin = await connect();
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    });

    test("a founding member starts at the first epoch", () => {
      expect(joinedEpochNumbers.get("rejoin-alice")).toBe(1);
      expect(joinedEpochNumbers.get("other-erin")).toBe(1);
    });

    test("a member who joined later starts at their first device wrap", () => {
      expect(joinedEpochNumbers.get("rejoin-carol")).toBe(3);
    });

    test("a member with no device wraps in the group starts at the latest epoch", () => {
      expect(joinedEpochNumbers.get("rejoin-dave")).toBe(4);
      expect(joinedEpochNumbers.get("rejoin-erin")).toBe(4);
    });

    test("a member of a group with no epochs starts at 1", () => {
      expect(joinedEpochNumbers.get("empty-frank")).toBe(1);
    });

    test.failing(
      "OPE-230: a member removed and re-invited before the upgrade starts at their current membership",
      () => {
        expect(joinedEpochNumbers.get("rejoin-bob")).toBe(4);
      },
    );
  },
);
