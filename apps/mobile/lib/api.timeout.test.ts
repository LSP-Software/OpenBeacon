import { TRPCClientError } from "@trpc/client";
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { SERVER_UNREACHABLE_MESSAGE } from "./serverUnreachable.ts";

let answering = false;
let connectionsOpened = 0;
let openConnections = 0;

const server = Bun.listen<{ request: string }>({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open: (socket) => {
      socket.data = { request: "" };
      connectionsOpened += 1;
      openConnections += 1;
    },
    data: (socket, chunk) => {
      socket.data.request += chunk.toString();
      if (!answering || !socket.data.request.includes("\r\n\r\n")) return;
      const paths = socket.data.request.split(" ")[1]?.split("?")[0]?.split("/").at(-1) ?? "";
      const body = JSON.stringify(paths.split(",").map(() => ({ result: { data: { json: [] } } })));
      socket.end(
        `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body).toString()}\r\nConnection: close\r\n\r\n${body}`,
      );
    },
    close: () => {
      openConnections -= 1;
    },
  },
});

const url = `http://127.0.0.1:${server.port.toString()}`;
mock.module("./storage.ts", () => ({
  storage: { getString: () => undefined, set: () => {}, remove: () => {}, contains: () => false },
}));
mock.module("./base-url.ts", () => ({ baseUrl: url, getFeedbackUrl: () => url }));
mock.module("./auth-client.ts", () => ({ authClient: { getCookie: () => null } }));

const { queryClient, trpc, trpcClient }: typeof import("./api.ts") = await import("./api.ts");

beforeEach(async () => {
  answering = false;
  while (openConnections > 0) await Bun.sleep(10);
  connectionsOpened = 0;
  queryClient.clear();
});

afterAll(() => {
  server.stop(true);
});

const listGroups = (timeoutMs: number) =>
  trpcClient.groupMembership.list.query(undefined, { context: { timeoutMs } });

const failedAfter = async (request: Promise<unknown>) => {
  const start = performance.now();
  const error = await request.then(
    () => null,
    (cause: unknown) => cause,
  );
  return { elapsed: performance.now() - start, error };
};

const waitUntil = async (condition: () => boolean) => {
  const deadline = performance.now() + 2_000;
  while (!condition() && performance.now() < deadline) await Bun.sleep(5);
  return condition();
};

test("a call the server never answers gives up at its own limit", async () => {
  const { elapsed, error } = await failedAfter(listGroups(100));

  expect(error).toHaveProperty("message", SERVER_UNREACHABLE_MESSAGE);
  expect(elapsed).toBeGreaterThanOrEqual(95);
  expect(elapsed).toBeLessThan(2_000);
});

test("batched calls each give up at their own limit and close the connection after the last", async () => {
  const short = failedAfter(listGroups(100));
  const long = failedAfter(
    trpcClient.groupTracking.getLatest.query(
      { groupId: "group" },
      { context: { timeoutMs: 1_500 } },
    ),
  );

  const shortResult = await short;
  expect(await waitUntil(() => connectionsOpened === 1)).toBe(true);
  expect(openConnections).toBe(1);

  const longResult = await long;
  expect(await waitUntil(() => openConnections === 0)).toBe(true);
  expect(shortResult.elapsed).toBeLessThan(1_000);
  expect(longResult.elapsed).toBeGreaterThanOrEqual(1_495);
  expect(longResult.error).toHaveProperty("message", SERVER_UNREACHABLE_MESSAGE);
  expect(connectionsOpened).toBe(1);
});

test("a caller's abort ends the call at once and closes the connection", async () => {
  const controller = new AbortController();
  const request = failedAfter(
    trpcClient.groupMembership.list.query(undefined, { signal: controller.signal }),
  );
  expect(await waitUntil(() => openConnections === 1)).toBe(true);

  controller.abort();
  const { elapsed, error } = await request;

  expect(error).toHaveProperty("message", "Request cancelled");
  expect(elapsed).toBeLessThan(2_000);
  expect(await waitUntil(() => openConnections === 0)).toBe(true);
});

test("a query that timed out is not retried", async () => {
  const options = trpc.groupMembership.list.queryOptions(undefined, {
    trpc: { context: { timeoutMs: 100 } },
  });

  const { error } = await failedAfter(queryClient.fetchQuery(options));

  expect(error).toHaveProperty("message", SERVER_UNREACHABLE_MESSAGE);
  expect(queryClient.getQueryState(options.queryKey)?.fetchFailureCount).toBe(1);
  expect(connectionsOpened).toBe(1);
});

test("other failed queries are still retried", () => {
  const retry = queryClient.getDefaultOptions().queries?.retry;
  if (typeof retry !== "function") throw new Error("retry is not configured");

  expect(retry(0, new Error("Internal server error"))).toBe(true);
  expect(retry(3, new Error("Internal server error"))).toBe(false);
});

test("a query the server refused is not retried", () => {
  const retry = queryClient.getDefaultOptions().queries?.retry;
  if (typeof retry !== "function") throw new Error("retry is not configured");

  for (const code of [
    "BAD_REQUEST",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NOT_FOUND",
    "TOO_MANY_REQUESTS",
  ]) {
    const error = new TRPCClientError("Refused", {
      result: { error: { code: -32603, message: "Refused", data: { code } } },
    });
    expect(retry(0, error)).toBe(false);
  }
  const serverError = new TRPCClientError("Failed", {
    result: { error: { code: -32603, message: "Failed", data: { code: "INTERNAL_SERVER_ERROR" } } },
  });
  expect(retry(0, serverError)).toBe(true);
});

test("calls work again once the server answers", async () => {
  const { error } = await failedAfter(listGroups(100));
  expect(error).toHaveProperty("message", SERVER_UNREACHABLE_MESSAGE);

  answering = true;
  expect(await listGroups(1_000)).toEqual([]);
});
