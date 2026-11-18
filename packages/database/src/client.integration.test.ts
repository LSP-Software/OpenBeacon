import { describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Socket } from "bun";

setDefaultTimeout(60_000);

const createSilentProxy = (target: URL) => {
  const connections: { silent: boolean }[] = [];
  let silenceNew = false;
  const proxy = Bun.listen<{ upstream: Socket | null; queue: Uint8Array[]; silent: boolean }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open: (socket) => {
        socket.data = { upstream: null, queue: [], silent: silenceNew };
        connections.push(socket.data);
        void Bun.connect({
          hostname: target.hostname,
          port: Number(target.port || 5432),
          socket: {
            open: (upstream) => {
              socket.data.upstream = upstream;
              for (const chunk of socket.data.queue) upstream.write(chunk);
            },
            data: (_upstream, data) => {
              if (!socket.data.silent) socket.write(data);
            },
            close: () => {
              if (!socket.data.silent) socket.end();
            },
            error: () => {},
          },
        });
      },
      data: (socket, data) => {
        if (socket.data.silent) return;
        if (socket.data.upstream) socket.data.upstream.write(data);
        else socket.data.queue.push(new Uint8Array(data));
      },
      close: (socket) => {
        socket.data.upstream?.end();
      },
      error: () => {},
    },
  });
  const url = new URL(target.toString());
  url.hostname = "127.0.0.1";
  url.port = String(proxy.port);
  return {
    url: url.toString(),
    silence: () => {
      silenceNew = true;
      for (const connection of connections) connection.silent = true;
    },
    restore: () => {
      silenceNew = false;
    },
    stop: () => proxy.stop(true),
  };
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("database client timeouts", () => {
  test("statements on the shared client stop after 30 seconds", async () => {
    const { prisma } = await import("./client.ts");
    expect(await prisma.$queryRaw`SHOW statement_timeout`).toEqual([{ statement_timeout: "30s" }]);
  });

  test("a lock wait on the shared client gives up after 4 seconds", async () => {
    const { prisma } = await import("./client.ts");
    expect(await prisma.$queryRaw`SHOW lock_timeout`).toEqual([{ lock_timeout: "4s" }]);
  });

  test("queries on connections that stop answering fail at the query timeout, and the pool recovers", async () => {
    const { createPrismaClient } = await import("./client.ts");
    const proxy = createSilentProxy(new URL(process.env["DATABASE_URL"] ?? ""));
    const db = createPrismaClient({
      connectionString: proxy.url,
      max: 2,
      connectionTimeoutMillis: 500,
      query_timeout: 1_000,
    });
    await Promise.all([db.$queryRaw`SELECT 1`, db.$queryRaw`SELECT 1`]);

    proxy.silence();
    const stuck = [db.$queryRaw`SELECT 1`, db.$queryRaw`SELECT 1`].map((query) =>
      Promise.resolve(query).then(
        () => "answered",
        (error: Error) => error.message,
      ),
    );
    const started = performance.now();
    for (const outcome of await Promise.all(stuck)) expect(outcome).toContain("Query read timeout");
    expect(performance.now() - started).toBeLessThan(3_000);

    proxy.restore();
    expect(await db.$queryRaw`SELECT 1 AS ok`).toEqual([{ ok: 1 }]);
    await db.$disconnect();
    proxy.stop();
  });

  test("a statement that runs past the statement timeout is cancelled", async () => {
    const { createPrismaClient } = await import("./client.ts");
    const db = createPrismaClient({
      connectionString: process.env["DATABASE_URL"] ?? "",
      statement_timeout: 200,
    });
    const start = performance.now();

    await expect(Promise.resolve(db.$queryRaw`SELECT pg_sleep(5)`)).rejects.toThrow(
      "statement timeout",
    );
    expect(performance.now() - start).toBeLessThan(2_000);
    await db.$disconnect();
  });

  test("a query waiting for a free connection gives up at the connection timeout", async () => {
    const { createPrismaClient } = await import("./client.ts");
    const db = createPrismaClient({
      connectionString: process.env["DATABASE_URL"] ?? "",
      max: 1,
      connectionTimeoutMillis: 200,
    });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = () => {};
    const holding = new Promise<void>((resolve) => {
      started = resolve;
    });
    const transaction = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1`;
      started();
      await held;
    });
    await holding;
    const start = performance.now();

    await expect(Promise.resolve(db.$queryRaw`SELECT 1`)).rejects.toThrow(
      "timeout exceeded when trying to connect",
    );
    expect(performance.now() - start).toBeLessThan(2_000);
    release();
    await transaction;
    await db.$disconnect();
  });
});
