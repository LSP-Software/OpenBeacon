import { describe, expect, mock, test } from "bun:test";
import type { PublishResult } from "./commands.ts";
import { createMapTilesHandler } from "./server.ts";

const apiKey = "k".repeat(40);

const request = (path: string, { key, method = "GET" }: { key?: string; method?: string } = {}) =>
  new Request(`http://map-tiles${path}`, {
    method,
    headers: key === undefined ? {} : { authorization: `Bearer ${key}` },
  });

describe("map tiles service", () => {
  test("answers health checks without the key", async () => {
    const handler = createMapTilesHandler({ apiKey, runUpdate: mock() });
    expect((await handler.fetch(request("/health"))).status).toBe(200);
  });

  test("rejects requests without the right key", async () => {
    const runUpdate = mock(async (): Promise<PublishResult> => ({ published: false, message: "" }));
    const handler = createMapTilesHandler({ apiKey, runUpdate });

    for (const key of [undefined, "", "wrong", `${apiKey}x`]) {
      expect((await handler.fetch(request("/update", { key, method: "POST" }))).status).toBe(401);
      expect((await handler.fetch(request("/status", { key }))).status).toBe(401);
    }
    expect(runUpdate).not.toHaveBeenCalled();
  });

  test("starts one update at a time and reports how it finished", async () => {
    let finish: (result: PublishResult) => void = () => {};
    const runUpdate = mock(
      () =>
        new Promise<PublishResult>((resolve) => {
          finish = resolve;
        }),
    );
    const handler = createMapTilesHandler({ apiKey, now: () => 0, runUpdate });

    const first = await handler.fetch(request("/update", { key: apiKey, method: "POST" }));
    const second = await handler.fetch(request("/update", { key: apiKey, method: "POST" }));

    expect(first.status).toBe(202);
    expect(await second.json()).toMatchObject({ alreadyRunning: true, running: true });
    expect(runUpdate).toHaveBeenCalledTimes(1);

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
    });
  });

  test("records a failed update and allows another attempt", async () => {
    const runUpdate = mock(async (): Promise<PublishResult> => {
      throw new Error("Upload stopped");
    });
    const handler = createMapTilesHandler({ apiKey, now: () => 0, runUpdate });

    await handler.fetch(request("/update", { key: apiKey, method: "POST" }));
    await handler.idle();
    const status = await (await handler.fetch(request("/status", { key: apiKey }))).json();
    await handler.fetch(request("/update", { key: apiKey, method: "POST" }));
    await handler.idle();

    expect(status).toMatchObject({ last: { outcome: "failed", message: "Upload stopped" } });
    expect(runUpdate).toHaveBeenCalledTimes(2);
  });
});
