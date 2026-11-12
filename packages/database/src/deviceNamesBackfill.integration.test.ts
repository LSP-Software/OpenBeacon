import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { Client } from "pg";

setDefaultTimeout(60_000);

const migrationsUrl = new URL("../prisma/migrations/", import.meta.url);
const backfillMigration = "20261111005334_device_names_and_sessions";
const databaseName = `openbeacon_migration_${crypto.randomUUID().replaceAll("-", "")}`;
const createdAt = new Date(Date.UTC(2026, 10, 1, 9));
const devices = new Map<
  string,
  {
    name: string;
    icon: string;
    activatedAt: Date | null;
    activatedBy: string | null;
    lastLocationAt: Date | null;
  }
>();

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

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "device names backfill migration",
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
      await client.query(
        `INSERT INTO "User" (id, name, email, "updatedAt") VALUES ('alice', 'alice', 'alice@example.test', now())`,
      );
      const seeded: Array<{ id: string; model: string | null; revokedAt: Date | null }> = [
        { id: "pixel", model: "Pixel 9", revokedAt: null },
        { id: "ipad", model: "iPad Air", revokedAt: null },
        { id: "galaxy-tab", model: "Galaxy Tab S9", revokedAt: null },
        { id: "no-model", model: null, revokedAt: null },
        { id: "blank-model", model: "  ", revokedAt: null },
        { id: "revoked", model: "Pixel 7", revokedAt: new Date(Date.UTC(2026, 10, 2)) },
      ];
      for (const { id, model, revokedAt } of seeded) {
        await client.query(
          `INSERT INTO "UserDevice" (id, "userId", "publicKey", "publicKeyAlgorithm", model, "createdAt", "revokedAt") VALUES ($1, 'alice', 'key', 'x25519', $2, $3, $4)`,
          [id, model, createdAt, revokedAt],
        );
      }
      await applyMigrations(client, migrations.slice(backfillIndex));
      const { rows } = await client.query<{
        id: string;
        name: string;
        icon: string;
        activatedAt: Date | null;
        activatedBy: string | null;
        lastLocationAt: Date | null;
      }>(`SELECT id, name, icon, "activatedAt", "activatedBy", "lastLocationAt" FROM "UserDevice"`);
      await client.end();
      for (const { id, ...device } of rows) devices.set(id, device);
    });

    afterAll(async () => {
      const admin = await connect();
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    });

    test("a device is named after its model", () => {
      expect(devices.get("pixel")).toMatchObject({ name: "Pixel 9", icon: "phone" });
    });

    test("an iPad or a Tab gets the tablet icon", () => {
      expect(devices.get("ipad")).toMatchObject({ name: "iPad Air", icon: "tablet" });
      expect(devices.get("galaxy-tab")).toMatchObject({ name: "Galaxy Tab S9", icon: "tablet" });
    });

    test("a device without a model is called Phone", () => {
      expect(devices.get("no-model")).toMatchObject({ name: "Phone", icon: "phone" });
      expect(devices.get("blank-model")).toMatchObject({ name: "Phone", icon: "phone" });
    });

    test("devices that aren't revoked are active from when they were added", () => {
      expect(devices.get("pixel")).toMatchObject({
        activatedAt: createdAt,
        activatedBy: "existing",
        lastLocationAt: null,
      });
    });

    test("a revoked device stays inactive", () => {
      expect(devices.get("revoked")).toMatchObject({
        name: "Pixel 7",
        activatedAt: null,
        activatedBy: null,
      });
    });
  },
);
