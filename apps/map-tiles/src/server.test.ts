import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { PublishResult } from "./commands.ts";
import { createMapTilesHandler, MAX_TIMEOUT_MS } from "./server.ts";
import type { MapStatus } from "./status.ts";

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
  rejectedBuild: null,
  speedLimitMbps: null,
  untrackedArchives: [],
  resumableUploads: [],
};

const request = (path: string, { body, method = "GET" }: { body?: string; method?: string } = {}) =>
  new Request(`http://map-tiles${path}`, {
    method,
    ...(body === undefined ? {} : { body }),
  });

const createHandler = ({
  now = () => 0,
  readMapStatus = async () => map,
  rollback = mock(async () => "Rolled back"),
  runUpdate = mock(async (): Promise<PublishResult> => ({
    published: false,
    message: "",
  })),
}: {
  now?: () => number;
  readMapStatus?: () => Promise<MapStatus>;
  rollback?: () => Promise<string>;
  runUpdate?: (options: { manual: boolean }) => Promise<PublishResult>;
} = {}) => createMapTilesHandler({ now, readMapStatus, rollback, runUpdate });

describe("map tiles service", () => {
  test("answers health checks without the key", async () => {
    expect((await createHandler().fetch(request("/health"))).status).toBe(200);
  });

  test("answers unknown paths and methods without running anything", async () => {
    const runUpdate = mock(async (): Promise<PublishResult> => ({
      published: false,
      message: "",
    }));
    const rollback = mock(async () => "");
    const handler = createHandler({ rollback, runUpdate });

    expect((await handler.fetch(request("/nope"))).status).toBe(404);
    expect((await handler.fetch(request("/update"))).status).toBe(405);
    expect((await handler.fetch(request("/rollback"))).status).toBe(405);
    expect(runUpdate).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  test("starts one update at a time and reports how it finished", async () => {
    let finish: (result: PublishResult) => void = () => {};
    const runUpdate = mock(
      (_options: { manual: boolean }) =>
        new Promise<PublishResult>((resolve) => {
          finish = resolve;
        }),
    );
    const handler = createHandler({ runUpdate });

    const first = await handler.fetch(request("/update", { method: "POST" }));
    const second = await handler.fetch(request("/update", { method: "POST" }));

    expect(first.status).toBe(202);
    expect(await second.json()).toMatchObject({
      alreadyRunning: true,
      running: true,
    });
    expect(runUpdate).toHaveBeenCalledTimes(1);
    expect(runUpdate).toHaveBeenCalledWith({ manual: false });

    finish({ published: true, message: "Published build 20261201 to slot b." });
    await handler.idle();

    expect(await (await handler.fetch(request("/status"))).json()).toEqual({
      running: false,
      startedAt: null,
      nextCheckAt: null,
      last: {
        finishedAt: new Date(0).toISOString(),
        outcome: "published",
        message: "Published build 20261201 to slot b.",
      },
      map,
    });
  });

  test("a forced update ignores the update interval", async () => {
    const runUpdate = mock(async (): Promise<PublishResult> => ({
      published: false,
      message: "",
    }));
    const handler = createHandler({ runUpdate });

    await handler.fetch(
      request("/update", {
        body: '{"force":true}',
        method: "POST",
      }),
    );
    await handler.idle();

    expect(runUpdate).toHaveBeenCalledWith({ manual: true });
    expect((await handler.fetch(request("/update", { body: "nope", method: "POST" }))).status).toBe(
      400,
    );
  });

  test("records a failed update and allows another attempt", async () => {
    const runUpdate = mock(async (): Promise<PublishResult> => {
      throw new Error("Upload stopped");
    });
    const handler = createHandler({ runUpdate });

    await handler.fetch(request("/update", { method: "POST" }));
    await handler.idle();
    const status = await (await handler.fetch(request("/status"))).json();
    await handler.fetch(request("/update", { method: "POST" }));
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

    await handler.fetch(request("/update", { method: "POST" }));
    expect((await handler.fetch(request("/rollback", { method: "POST" }))).status).toBe(409);
    expect(rollback).not.toHaveBeenCalled();

    finish({ published: false, message: "" });
    await handler.idle();
    const response = await handler.fetch(request("/rollback", { method: "POST" }));

    expect(await response.json()).toEqual({
      message: "Rolled back from b-20261201 to a-20261107.",
    });
  });

  describe("scheduled updates", () => {
    const HOUR_MS = 3_600_000;
    const DAY_MS = 24 * HOUR_MS;
    let timers: { callback: () => void; delay: number }[] = [];
    let setTimeoutSpy: ReturnType<typeof spyOn<typeof globalThis, "setTimeout">>;
    let clearTimeoutSpy: ReturnType<typeof spyOn<typeof globalThis, "clearTimeout">>;
    let logSpy: ReturnType<typeof spyOn<typeof console, "log">>;

    beforeEach(() => {
      timers = [];
      setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(((
        callback: () => void,
        delay: number,
      ) => {
        timers.push({ callback, delay });
        return timers.length;
      }) as unknown as typeof setTimeout);
      clearTimeoutSpy = spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
      logSpy = spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
      logSpy.mockRestore();
    });

    const settle = () => Bun.sleep(1);

    test("checks on start and again when the map in use is due", async () => {
      let clock = Date.parse("2026-11-20T00:00:00.000Z");
      const runUpdate = mock(async (_options: { manual: boolean }): Promise<PublishResult> => ({
        published: false,
        message: "",
      }));
      const handler = createHandler({ now: () => clock, runUpdate });

      const stop = handler.scheduleUpdates(30 * DAY_MS);
      await settle();
      expect(runUpdate).toHaveBeenCalledTimes(1);
      expect(runUpdate).toHaveBeenLastCalledWith({ manual: false });
      expect(timers.map((timer) => timer.delay)).toEqual([18 * DAY_MS]);
      expect(await (await handler.fetch(request("/status"))).json()).toMatchObject({
        nextCheckAt: "2026-12-08T00:00:00.000Z",
      });

      clock += 18 * DAY_MS;
      timers[0]?.callback();
      await settle();
      expect(runUpdate).toHaveBeenCalledTimes(2);
      expect(timers[1]?.delay).toBe(MAX_TIMEOUT_MS);

      stop();
      expect(clearTimeoutSpy).toHaveBeenCalledWith(2);
    });

    test("waits a full interval, split to fit the timer, when the map is due but nothing newer was published", async () => {
      let clock = Date.parse("2026-12-08T00:00:00.000Z");
      const runUpdate = mock(async (_options: { manual: boolean }): Promise<PublishResult> => ({
        published: false,
        message: "Build 20261107 is already current",
      }));
      const handler = createHandler({ now: () => clock, runUpdate });

      const stop = handler.scheduleUpdates(30 * DAY_MS);
      await settle();
      expect(timers.map((timer) => timer.delay)).toEqual([MAX_TIMEOUT_MS]);

      clock += MAX_TIMEOUT_MS;
      timers[0]?.callback();
      await settle();
      expect(runUpdate).toHaveBeenCalledTimes(1);
      expect(timers[1]?.delay).toBe(30 * DAY_MS - MAX_TIMEOUT_MS);
      stop();
    });

    test("retries a failed update after an hour, doubling up to a day, until one succeeds", async () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      let clock = Date.parse("2026-12-08T00:00:00.000Z");
      let fail = true;
      const runUpdate = mock(async (_options: { manual: boolean }): Promise<PublishResult> => {
        if (fail) {
          throw new Error("Upload stopped");
        }
        return {
          published: false,
          message: "Build 20261107 is already current",
        };
      });
      const handler = createHandler({ now: () => clock, runUpdate });

      const stop = handler.scheduleUpdates(30 * DAY_MS);
      await settle();
      for (let check = 1; check < 7; check++) {
        clock += timers.at(-1)?.delay ?? 0;
        timers.at(-1)?.callback();
        await settle();
      }
      expect(timers.map((timer) => timer.delay / HOUR_MS)).toEqual([1, 2, 4, 8, 16, 24, 24]);

      fail = false;
      clock += DAY_MS;
      timers.at(-1)?.callback();
      await settle();
      expect(timers.at(-1)?.delay).toBe(MAX_TIMEOUT_MS);

      stop();
      errorSpy.mockRestore();
    });

    test("retries after an hour when the map can't be read or there is no map yet", async () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const unreadable = createHandler({
        now: () => Date.parse("2026-11-20T00:00:00.000Z"),
        readMapStatus: async () => {
          throw new Error("R2 unavailable");
        },
      });
      const empty = createHandler({
        now: () => Date.parse("2026-11-20T00:00:00.000Z"),
        readMapStatus: async () => ({
          ...map,
          current: null,
          nextUpdateDueAt: null,
        }),
      });

      const stops = [unreadable.scheduleUpdates(30 * DAY_MS), empty.scheduleUpdates(30 * DAY_MS)];
      await settle();

      expect(timers.map((timer) => timer.delay)).toEqual([HOUR_MS, HOUR_MS]);
      expect(errorSpy).toHaveBeenCalledWith("Could not read the map from R2: R2 unavailable");
      for (const stop of stops) {
        stop();
      }
      errorSpy.mockRestore();
    });

    test("a manual update during a scheduled check does not start a second one", async () => {
      let finish: (result: PublishResult) => void = () => {};
      const runUpdate = mock(
        (_options: { manual: boolean }) =>
          new Promise<PublishResult>((resolve) => {
            finish = resolve;
          }),
      );
      const handler = createHandler({ runUpdate });

      const stop = handler.scheduleUpdates(30 * DAY_MS);
      const manual = await handler.fetch(request("/update", { method: "POST" }));
      expect(await manual.json()).toMatchObject({ alreadyRunning: true, nextCheckAt: null });
      expect(runUpdate).toHaveBeenCalledTimes(1);

      stop();
      finish({ published: false, message: "" });
      await handler.idle();
      await settle();
      expect(timers).toEqual([]);
    });
  });

  test("an update waits for a running rollback, and a second rollback is refused", async () => {
    let finishRollback: (message: string) => void = () => {};
    const rollback = mock(
      () =>
        new Promise<string>((resolve) => {
          finishRollback = resolve;
        }),
    );
    const runUpdate = mock(async (): Promise<PublishResult> => ({
      published: false,
      message: "",
    }));
    const handler = createHandler({ rollback, runUpdate });

    const rolling = handler.fetch(request("/rollback", { method: "POST" }));
    await Bun.sleep(0);
    expect((await handler.fetch(request("/rollback", { method: "POST" }))).status).toBe(409);
    expect((await handler.fetch(request("/update", { method: "POST" }))).status).toBe(202);
    await Bun.sleep(0);
    expect(runUpdate).not.toHaveBeenCalled();

    finishRollback("Rolled back");
    expect((await rolling).status).toBe(200);
    await handler.idle();
    expect(runUpdate).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  test("reports why a rollback failed", async () => {
    const handler = createHandler({
      rollback: async () => {
        throw new Error("There is no previous map");
      },
    });

    const response = await handler.fetch(request("/rollback", { method: "POST" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "There is no previous map",
    });
  });
});
