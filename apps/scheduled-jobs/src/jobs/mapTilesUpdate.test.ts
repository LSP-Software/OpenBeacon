import { describe, expect, mock, test } from "bun:test";
import { checkMapTiles, createMapTilesUpdate } from "./mapTilesUpdate.ts";

const apiKey = "k".repeat(40);

const respond = (status: number, body: unknown) =>
  mock(async (_input: string | URL | Request, _init?: RequestInit) =>
    Response.json(body, { status }),
  );

describe("map tiles update job", () => {
  test("is not scheduled unless both the service URL and key are set", () => {
    expect(createMapTilesUpdate({ apiKey, url: undefined })).toBeNull();
    expect(createMapTilesUpdate({ apiKey: undefined, url: "http://map-tiles:8080" })).toBeNull();
  });

  test("asks the service to update with the shared key", async () => {
    const fetch = respond(202, { alreadyRunning: false, last: null });
    const run = createMapTilesUpdate({
      apiKey,
      fetch: fetch as unknown as typeof globalThis.fetch,
      url: "http://map-tiles:8080",
    });

    await run?.();

    const [input, init] = fetch.mock.calls[0] ?? [];
    expect(String(input)).toBe("http://map-tiles:8080/update");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
  });

  test("fails with a code when the service rejects the key", async () => {
    const run = createMapTilesUpdate({
      apiKey,
      fetch: respond(401, {}) as unknown as typeof globalThis.fetch,
      url: "http://map-tiles:8080",
    });

    await expect(run?.()).rejects.toMatchObject({ code: "MAP_TILES_HTTP_401" });
  });

  test("surfaces a failed previous update so it shows in the runner logs", async () => {
    const run = createMapTilesUpdate({
      apiKey,
      fetch: respond(202, {
        alreadyRunning: false,
        last: { finishedAt: "2026-11-12T00:00:00.000Z", outcome: "failed", message: "boom" },
      }) as unknown as typeof globalThis.fetch,
      url: "http://map-tiles:8080",
    });

    await expect(run?.()).rejects.toMatchObject({ code: "MAP_TILES_UPDATE_FAILED" });
  });
});

describe("map tiles startup check", () => {
  test("reads the service status with the shared key", async () => {
    const fetch = respond(200, {});

    await checkMapTiles({
      apiKey,
      fetch: fetch as unknown as typeof globalThis.fetch,
      url: "http://map-tiles:8080",
    });

    const [input, init] = fetch.mock.calls[0] ?? [];
    expect(String(input)).toBe("http://map-tiles:8080/status");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
  });

  test("fails when the service rejects the key or can't read R2", async () => {
    const error = mock(() => {});
    const original = console.error;
    console.error = error;
    try {
      for (const status of [401, 502]) {
        await expect(
          checkMapTiles({
            apiKey,
            fetch: respond(status, {}) as unknown as typeof globalThis.fetch,
            url: "http://map-tiles:8080",
          }),
        ).rejects.toThrow(`The map tiles service answered ${status}`);
      }
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      console.error = original;
    }
  });

  test("fails when the service can't be reached", async () => {
    await expect(
      checkMapTiles({
        apiKey,
        fetch: mock(async () => {
          throw new TypeError("Unable to connect");
        }) as unknown as typeof globalThis.fetch,
        url: "http://map-tiles:8080",
      }),
    ).rejects.toThrow("Unable to connect");
  });
});
