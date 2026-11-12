import { describe, expect, mock, test } from "bun:test";
import { createMapTilesClient, formatStatus } from "./client.ts";
import type { ServiceStatus } from "./status.ts";

const apiKey = "k".repeat(40);
const now = Date.parse("2026-12-03T00:00:00.000Z");

const status: ServiceStatus = {
  running: false,
  startedAt: null,
  last: {
    finishedAt: "2026-12-02T03:00:00.000Z",
    outcome: "published",
    message: "Published build 20261201 to slot b.",
  },
  map: {
    bucket: "maps",
    current: "b",
    slots: {
      a: {
        build: "20261101",
        publishedAt: "2026-11-02T03:00:00.000Z",
        schemaVersion: "4.15.2",
        servedUntil: "2026-12-09T03:00:00.000Z",
        size: 1024,
      },
      b: {
        build: "20261201",
        publishedAt: "2026-12-02T03:00:00.000Z",
        schemaVersion: "4.15.2",
        servedUntil: null,
        size: 1024,
      },
    },
    standbyReplaceableFrom: "2026-12-10T03:00:00.000Z",
    nextUpdateDueAt: "2027-01-01T03:00:00.000Z",
    speedLimitMbps: null,
    untrackedArchives: [],
    resumableUploads: [],
  },
};

describe("formatStatus", () => {
  test("shows which slot is in use and the Protomaps build in each", () => {
    const text = formatStatus({ now, status });

    expect(text).toContain("Map in use: slot B");
    expect(text).toContain("Slot A: Protomaps build 2026-11-01");
    expect(text).toContain("still served to open maps until 2026-12-09T03:00:00.000Z");
    expect(text).toContain("Slot B: Protomaps build 2026-12-01");
    expect(text).toContain("Last update: published");
  });

  test("shows the speed limit", () => {
    expect(formatStatus({ now, status })).toContain(
      "Speed limit: none (set MAP_TILES_MAX_MBPS to cap it)",
    );
    expect(
      formatStatus({ now, status: { ...status, map: { ...status.map, speedLimitMbps: 100 } } }),
    ).toContain("Speed limit: 100 Mbps each way (MAP_TILES_MAX_MBPS)");
  });

  test("explains that an empty bucket gets slot A first", () => {
    const text = formatStatus({
      now,
      status: {
        ...status,
        last: null,
        map: {
          ...status.map,
          current: null,
          slots: { a: null, b: null },
          standbyReplaceableFrom: null,
          nextUpdateDueAt: null,
        },
      },
    });

    expect(text).toContain("the next update downloads the map into slot A");
    expect(text).toContain("Slot A: empty");
  });
});

describe("createMapTilesClient", () => {
  test("asks the service for a forced update with the key", async () => {
    const fetch = mock(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json(
        { alreadyRunning: false, running: true, startedAt: null, last: null },
        {
          status: 202,
        },
      ),
    );
    const client = createMapTilesClient({
      apiKey,
      fetch: fetch as unknown as typeof globalThis.fetch,
      serviceUrl: "http://127.0.0.1:8080",
    });

    await client.update();

    const [input, init] = fetch.mock.calls[0] ?? [];
    expect(String(input)).toBe("http://127.0.0.1:8080/update");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
    expect(init?.body).toBe('{"force":true}');
  });

  test("shows the service's reason when it refuses", async () => {
    const client = createMapTilesClient({
      apiKey,
      fetch: (async () =>
        Response.json(
          { error: "An update is running" },
          { status: 409 },
        )) as unknown as typeof globalThis.fetch,
      serviceUrl: "http://127.0.0.1:8080",
    });

    await expect(client.rollback()).rejects.toThrow("An update is running");
  });

  test("says when the service cannot be reached", async () => {
    const client = createMapTilesClient({
      apiKey,
      fetch: (async () => {
        throw new Error("Connection refused");
      }) as unknown as typeof globalThis.fetch,
      serviceUrl: "http://127.0.0.1:8080",
    });

    await expect(client.status()).rejects.toThrow("Could not reach the map tiles service");
  });
});
