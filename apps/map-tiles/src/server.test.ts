import { describe, expect, mock, spyOn, test } from "bun:test";
import type { PublishResult } from "./commands.ts";
import { createMapTilesHandler } from "./server.ts";
import type { MapStatus } from "./status.ts";

const apiKey = "k".repeat(40);

const map: MapStatus = {
  bucket: "bucket",
  current: "a",
  slots: {
    a: {
      build: "20261107",
      publishedAt: "2026-11-08T00:00:00.000Z",
      schemaVersion: "4.15.2",
      servedUntil: null,
      size: 1000,
    },
    b: null,
  },
  standbyReplaceableFrom: null,
  nextUpdateDueAt: "2026-12-08T00:00:00.000Z",
  speedLimitMbps: null,
  untrackedArchives: [],
  resumableUploads: [],
};

const request = (
  path: string,
  { body, key, method = "GET" }: { body?: string; key?: string; method?: string } = {},
) =>
  new Request(`http://map-tiles${path}`, {
    method,
    headers: key === undefined ? {} : { authorization: `Bearer ${key}` },
    ...(body === undefined ? {} : { body }),
  });

const createHandler = ({
  rollback = mock(async () => "Rolled back"),
  runUpdate = mock(async (): Promise<PublishResult> => ({ published: false, message: "" })),
}: {
  rollback?: () => Promise<string>;
  runUpdate?: (options: { ignoreInterval: boolean }) => Promise<PublishResult>;
} = {}) =>
  createMapTilesHandler({
    apiKey,
    now: () => 0,
    readMapStatus: async () => map,
    rollback,
    runUpdate,
  });

describe("map tiles service", () => {
  test("answers health checks without the key", async () => {
    expect((await createHandler().fetch(request("/health"))).status).toBe(200);
  });

  test("rejects requests without the right key", async () => {
    const runUpdate = mock(async (): Promise<PublishResult> => ({ published: false, message: "" }));
    const rollback = mock(async () => "");
    const handler = createHandler({ rollback, runUpdate });

    for (const key of [undefined, "", "wrong", `${apiKey}x`]) {
      expect((await handler.fetch(request("/update", { key, method: "POST" }))).status).toBe(401);
      expect((await handler.fetch(request("/rollback", { key, method: "POST" }))).status).toBe(401);
      expect((await handler.fetch(request("/status", { key }))).status).toBe(401);
    }
    expect(runUpdate).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  test("starts one update at a time and reports how it finished", async () => {
    let finish: (result: PublishResult) => void = () => {};
    const runUpdate = mock(
      (_options: { ignoreInterval: boolean }) =>
        new Promise<PublishResult>((resolve) => {
          finish = resolve;
        }),
    );
    const handler = createHandler({ runUpdate });

    const first = await handler.fetch(request("/update", { key: apiKey, method: "POST" }));
    const second = await handler.fetch(request("/update", { key: apiKey, method: "POST" }));

    expect(first.status).toBe(202);
    expect(await second.json()).toMatchObject({
      alreadyRunning: true,
      running: true,
    });
    expect(runUpdate).toHaveBeenCalledTimes(1);
    expect(runUpdate).toHaveBeenCalledWith({ ignoreInterval: false });

    finish({ published: true, message: "Published build 20261201 to slot b." });
    await handler.idle();

    expect(await (await handler.fetch(request("/status", { key: apiKey }))).json()).toEqual({
      running: false,
      startedAt: null,
      last: {
        finishedAt: new Date(0).toISOString(),
        outcome: "published",
        message: "Published build 20261201 to slot b.",
      },
      map,
    });
  });

  test("a forced update ignores the update interval", async () => {
    const runUpdate = mock(async (): Promise<PublishResult> => ({ published: false, message: "" }));
    const handler = createHandler({ runUpdate });

    await handler.fetch(
      request("/update", {
        body: '{"force":true}',
        key: apiKey,
        method: "POST",
      }),
    );
    await handler.idle();

    expect(runUpdate).toHaveBeenCalledWith({ ignoreInterval: true });
    expect(
      (await handler.fetch(request("/update", { body: "nope", key: apiKey, method: "POST" })))
        .status,
    ).toBe(400);
  });

  test("records a failed update and allows another attempt", async () => {
    const runUpdate = mock(async (): Promise<PublishResult> => {
      throw new Error("Upload stopped");
    });
    const handler = createHandler({ runUpdate });

    await handler.fetch(request("/update", { key: apiKey, method: "POST" }));
    await handler.idle();
    const status = await (await handler.fetch(request("/status", { key: apiKey }))).json();
    await handler.fetch(request("/update", { key: apiKey, method: "POST" }));
    await handler.idle();

    expect(status).toMatchObject({
      last: { outcome: "failed", message: "Upload stopped" },
    });
    expect(runUpdate).toHaveBeenCalledTimes(2);
  });

  test("rolls back, but not while an update is running", async () => {
    let finish: (result: PublishResult) => void = () => {};
    const rollback = mock(async () => "Rolled back from b-20261201 to a-20261107.");
    const handler = createHandler({
      rollback,
      runUpdate: () =>
        new Promise<PublishResult>((resolve) => {
          finish = resolve;
        }),
    });

    await handler.fetch(request("/update", { key: apiKey, method: "POST" }));
    expect(
      (await handler.fetch(request("/rollback", { key: apiKey, method: "POST" }))).status,
    ).toBe(409);
    expect(rollback).not.toHaveBeenCalled();

    finish({ published: false, message: "" });
    await handler.idle();
    const response = await handler.fetch(request("/rollback", { key: apiKey, method: "POST" }));

    expect(await response.json()).toEqual({
      message: "Rolled back from b-20261201 to a-20261107.",
    });
  });

  test("checks for an update on start and then on every interval, one at a time", async () => {
    let tick: () => void = () => {};
    const setIntervalSpy = spyOn(globalThis, "setInterval").mockImplementation(((
      callback: () => void,
    ) => {
      tick = callback;
      return 1;
    }) as unknown as typeof setInterval);
    const clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
    let finish: (result: PublishResult) => void = () => {};
    const runUpdate = mock(
      (_options: { ignoreInterval: boolean }) =>
        new Promise<PublishResult>((resolve) => {
          finish = resolve;
        }),
    );
    const handler = createHandler({ runUpdate });

    const stop = handler.scheduleUpdates(86_400_000);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 86_400_000);
    expect(runUpdate).toHaveBeenCalledTimes(1);
    expect(runUpdate).toHaveBeenLastCalledWith({ ignoreInterval: false });

    tick();
    const manual = await handler.fetch(request("/update", { key: apiKey, method: "POST" }));
    expect(await manual.json()).toMatchObject({ alreadyRunning: true });
    expect(runUpdate).toHaveBeenCalledTimes(1);

    finish({ published: false, message: "Build 20261107 is already current" });
    await handler.idle();
    tick();
    expect(runUpdate).toHaveBeenCalledTimes(2);
    expect(runUpdate).toHaveBeenLastCalledWith({ ignoreInterval: false });

    stop();
    expect(clearIntervalSpy).toHaveBeenCalledWith(1);
    finish({ published: false, message: "" });
    await handler.idle();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  test("reports why a rollback failed", async () => {
    const handler = createHandler({
      rollback: async () => {
        throw new Error("There is no previous map");
      },
    });

    const response = await handler.fetch(request("/rollback", { key: apiKey, method: "POST" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "There is no previous map",
    });
  });
});
