import { serverVersion } from "@openbeacon/backend/version.ts";
import { serverNameSchema } from "@openbeacon/schemas";

export const startHealthServer = (port: number) => {
  const body = {
    status: "ok",
    version: serverVersion,
    serverName: serverNameSchema.parse(process.env["SERVER_NAME"]),
  };
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    routes: { "/health": { GET: () => Response.json(body) } },
    fetch: () => new Response("Not Found", { status: 404 }),
  });
};
