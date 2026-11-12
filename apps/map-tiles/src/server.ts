import { timingSafeEqual } from "node:crypto";
import { tryCatch } from "@openbeacon/shared";
import { z } from "zod";
import type { PublishResult } from "./commands.ts";
import type { MapStatus, UpdateRun } from "./status.ts";

const updateRequestSchema = z.object({ force: z.boolean().default(false) });

export const createMapTilesHandler = ({
  apiKey,
  now = Date.now,
  readMapStatus,
  rollback,
  runUpdate,
}: {
  apiKey: string;
  now?: () => number;
  readMapStatus: () => Promise<MapStatus>;
  rollback: () => Promise<string>;
  runUpdate: (options: { ignoreInterval: boolean }) => Promise<PublishResult>;
}) => {
  const expected = Buffer.from(apiKey);
  let running: { startedAt: string; task: Promise<void> } | null = null;
  let last: UpdateRun["last"] = null;

  const isAuthorized = (request: Request) => {
    const header = request.headers.get("authorization") ?? "";
    const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    const suppliedBytes = Buffer.from(supplied);
    return suppliedBytes.length === expected.length && timingSafeEqual(suppliedBytes, expected);
  };

  const describe = (): UpdateRun => ({
    running: running !== null,
    startedAt: running?.startedAt ?? null,
    last,
  });

  const start = (ignoreInterval: boolean) => {
    const task = (async () => {
      const result = await tryCatch(runUpdate({ ignoreInterval }));
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

  const requestUpdate = ({ ignoreInterval }: { ignoreInterval: boolean }) => {
    const alreadyRunning = running !== null;
    if (!alreadyRunning) {
      void start(ignoreInterval);
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

      if (!isAuthorized(request)) {
        return new Response("Unauthorized", { status: 401 });
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
        return Response.json(requestUpdate({ ignoreInterval: body.data.force }), {
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
        const result = await tryCatch(rollback());
        if (result.error) {
          return Response.json({ error: result.error.message }, { status: 409 });
        }
        return Response.json({ message: result.data });
      }

      return new Response("Method not allowed", { status: 405 });
    },
    idle: () => running?.task ?? Promise.resolve(),
    scheduleUpdates: (intervalMs: number) => {
      requestUpdate({ ignoreInterval: false });
      const timer = setInterval(() => requestUpdate({ ignoreInterval: false }), intervalMs);
      return () => clearInterval(timer);
    },
  };
};
