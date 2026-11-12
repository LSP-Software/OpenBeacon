import { tryCatch } from "@openbeacon/shared";
import { z } from "zod";
import type { PublishResult } from "./commands.ts";
import type { MapStatus, UpdateRun } from "./status.ts";

export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const updateRequestSchema = z.object({ force: z.boolean().default(false) });

export const createMapTilesHandler = ({
  now = Date.now,
  readMapStatus,
  rollback,
  runUpdate,
}: {
  now?: () => number;
  readMapStatus: () => Promise<MapStatus>;
  rollback: () => Promise<string>;
  runUpdate: (options: { manual: boolean }) => Promise<PublishResult>;
}) => {
  let running: { startedAt: string; task: Promise<void> } | null = null;
  let last: UpdateRun["last"] = null;
  let rollingBack: Promise<unknown> | null = null;
  let nextCheckAt: string | null = null;

  const describe = (): UpdateRun => ({
    running: running !== null,
    startedAt: running?.startedAt ?? null,
    nextCheckAt,
    last,
  });

  const start = (manual: boolean) => {
    const task = (async () => {
      if (rollingBack) {
        await rollingBack;
      }
      const result = await tryCatch(runUpdate({ manual }));
      const finishedAt = new Date(now()).toISOString();

      if (result.error) {
        console.error(`Map update failed: ${result.error.message}`);
        last = { finishedAt, outcome: "failed", message: result.error.message };
      } else {
        console.log(result.data.message);
        last = {
          finishedAt,
          outcome: result.data.published ? "published" : "skipped",
          message: result.data.message,
        };
      }
      running = null;
    })();
    running = { startedAt: new Date(now()).toISOString(), task };
    return task;
  };

  const requestUpdate = ({ manual }: { manual: boolean }) => {
    const alreadyRunning = running !== null;
    if (!alreadyRunning) {
      void start(manual);
    }
    return { ...describe(), alreadyRunning };
  };

  const readUpdateRequest = async (request: Request) => {
    const body = await tryCatch(
      request.text().then((text): unknown => (text.trim() === "" ? {} : JSON.parse(text))),
    );
    return updateRequestSchema.safeParse(body.error ? null : body.data);
  };

  return {
    fetch: async (request: Request) => {
      const { pathname } = new URL(request.url);

      if (pathname === "/health" && request.method === "GET") {
        return new Response("ok");
      }

      if (!["/status", "/update", "/rollback"].includes(pathname)) {
        return new Response("Not found", { status: 404 });
      }

      if (pathname === "/status" && request.method === "GET") {
        const map = await tryCatch(readMapStatus());
        if (map.error) {
          return Response.json(
            { error: `Could not read the map from R2: ${map.error.message}` },
            { status: 502 },
          );
        }
        return Response.json({ ...describe(), map: map.data });
      }

      if (pathname === "/update" && request.method === "POST") {
        const body = await readUpdateRequest(request);
        if (!body.success) {
          return Response.json({ error: 'Send {} or {"force": true}' }, { status: 400 });
        }
        return Response.json(requestUpdate({ manual: body.data.force }), {
          status: 202,
        });
      }

      if (pathname === "/rollback" && request.method === "POST") {
        if (running) {
          return Response.json(
            {
              error: `An update has been running since ${running.startedAt}; roll back after it finishes`,
            },
            { status: 409 },
          );
        }
        if (rollingBack) {
          return Response.json({ error: "A rollback is already running" }, { status: 409 });
        }
        const pending = tryCatch(rollback());
        rollingBack = pending;
        const result = await pending;
        rollingBack = null;
        if (result.error) {
          return Response.json({ error: result.error.message }, { status: 409 });
        }
        return Response.json({ message: result.data });
      }

      return new Response("Method not allowed", { status: 405 });
    },
    idle: () => running?.task ?? Promise.resolve(),
    scheduleUpdates: (intervalMs: number) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;
      let retries = 0;

      const waitUntil = (at: number) => {
        const delay = at - now();
        timer = setTimeout(
          () => (delay > MAX_TIMEOUT_MS ? waitUntil(at) : void check()),
          Math.min(Math.max(delay, 0), MAX_TIMEOUT_MS),
        );
      };

      const check = async () => {
        nextCheckAt = null;
        requestUpdate({ manual: false });
        await running?.task;
        const map = await tryCatch(readMapStatus());
        if (stopped) {
          return;
        }
        if (map.error) {
          console.error(`Could not read the map from R2: ${map.error.message}`);
        }
        const dueAt = map.data?.nextUpdateDueAt ? Date.parse(map.data.nextUpdateDueAt) : null;
        const retry = dueAt === null || last?.outcome === "failed";
        retries = retry ? retries + 1 : 0;
        const at = retry
          ? now() + Math.min(3_600_000 * 2 ** (retries - 1), 86_400_000)
          : dueAt > now()
            ? dueAt
            : now() + intervalMs;
        nextCheckAt = new Date(at).toISOString();
        console.log(`Next map update check at ${nextCheckAt}`);
        waitUntil(at);
      };

      void check();
      return () => {
        stopped = true;
        nextCheckAt = null;
        if (timer) {
          clearTimeout(timer);
        }
      };
    },
  };
};
