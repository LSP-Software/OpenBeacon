import { createHash, timingSafeEqual } from "node:crypto";
import { tryCatch } from "@openbeacon/shared";
import type { PublishResult } from "./commands.ts";

const digest = (value: string) => createHash("sha256").update(value).digest();

export const createMapTilesHandler = ({
  apiKey,
  now = Date.now,
  runUpdate,
}: {
  apiKey: string;
  now?: () => number;
  runUpdate: () => Promise<PublishResult>;
}) => {
  const expected = digest(apiKey);
  let running: { startedAt: string; task: Promise<void> } | null = null;
  let last: {
    finishedAt: string;
    outcome: "published" | "skipped" | "failed";
    message: string;
  } | null = null;

  const isAuthorized = (request: Request) => {
    const header = request.headers.get("authorization") ?? "";
    const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    return supplied.length > 0 && timingSafeEqual(digest(supplied), expected);
  };

  const describe = () => ({
    running: running !== null,
    startedAt: running?.startedAt ?? null,
    last,
  });

  const start = () => {
    const task = (async () => {
      const result = await tryCatch(runUpdate());
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

  return {
    fetch: async (request: Request) => {
      const { pathname } = new URL(request.url);

      if (pathname === "/health" && request.method === "GET") {
        return new Response("ok");
      }

      if (pathname !== "/status" && pathname !== "/update") {
        return new Response("Not found", { status: 404 });
      }

      if (!isAuthorized(request)) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (pathname === "/status" && request.method === "GET") {
        return Response.json(describe());
      }

      if (pathname === "/update" && request.method === "POST") {
        const alreadyRunning = running !== null;
        if (!alreadyRunning) {
          void start();
        }
        return Response.json({ ...describe(), alreadyRunning }, { status: 202 });
      }

      return new Response("Method not allowed", { status: 405 });
    },
    idle: () => running?.task ?? Promise.resolve(),
  };
};
