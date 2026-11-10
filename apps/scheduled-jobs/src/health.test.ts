import { afterEach, expect, test } from "bun:test";
import { serverVersion } from "@openbeacon/backend/version.ts";
import { startHealthServer } from "./health.ts";

let server: ReturnType<typeof startHealthServer> | undefined;

afterEach(async () => {
  await server?.stop(true);
  server = undefined;
});

test("reports the same health details as the backend on localhost only", async () => {
  process.env["SERVER_NAME"] = "Family server";
  server = startHealthServer(0);
  expect(server.hostname).toBe("127.0.0.1");
  const response = await fetch(`http://127.0.0.1:${server.port}/health`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: "ok",
    version: serverVersion,
    serverName: "Family server",
  });
  expect((await fetch(`http://127.0.0.1:${server.port}/other`)).status).toBe(404);
});

test("falls back to the default server name", async () => {
  delete process.env["SERVER_NAME"];
  server = startHealthServer(0);
  const response = await fetch(`http://127.0.0.1:${server.port}/health`);
  expect(await response.json()).toMatchObject({ serverName: "OpenBeacon" });
});
