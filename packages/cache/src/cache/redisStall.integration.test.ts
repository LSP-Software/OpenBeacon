import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Socket } from "bun";
import { testRedisHashSecret } from "../rateLimits/testUtils.ts";
import { OpenBeaconCache } from "./OpenBeaconCache.ts";

setDefaultTimeout(30_000);

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "a Redis connection that stops answering without closing",
  () => {
    const redisUrl = new URL(process.env["REDIS_URL"] ?? "redis://localhost:6379");
    let stalled = false;
    let opened = 0;
    const proxy = Bun.listen<{ upstream: Socket | null; queue: Uint8Array[] }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open: (socket) => {
          opened += 1;
          socket.data = { upstream: null, queue: [] };
          void Bun.connect({
            hostname: redisUrl.hostname,
            port: Number(redisUrl.port || 6379),
            socket: {
              open: (upstream) => {
                socket.data.upstream = upstream;
                for (const chunk of socket.data.queue) upstream.write(chunk);
              },
              data: (_upstream, data) => {
                if (!stalled) socket.write(data);
              },
              close: () => socket.end(),
              error: () => {},
            },
          });
        },
        data: (socket, data) => {
          if (stalled) return;
          if (socket.data.upstream) socket.data.upstream.write(data);
          else socket.data.queue.push(new Uint8Array(data));
        },
        close: (socket) => {
          socket.data.upstream?.end();
        },
        error: () => {},
      },
    });
    const proxiedUrl = new URL(redisUrl.toString());
    proxiedUrl.hostname = "127.0.0.1";
    proxiedUrl.port = String(proxy.port);
    const cache = new OpenBeaconCache({
      redisUrl: proxiedUrl.toString(),
      hashSecret: testRedisHashSecret,
      keyPrefix: `test-${crypto.randomUUID()}`,
    });
    afterAll(() => {
      cache.close();
      proxy.stop(true);
    });
    const limit = {
      namespace: "stall",
      identifier: { type: "userId" as const, value: "user" },
      limit: 1_000,
      windowMs: 60_000,
    };
    const timed = async () => {
      const started = performance.now();
      const result = await cache.rateLimits.consume(limit, { whenUnavailable: "allow" });
      return { ms: performance.now() - started, unavailable: result.unavailable ?? false };
    };

    test("pays the command timeout once, then fails fast and opens a new connection when Redis answers again", async () => {
      expect(await timed()).toMatchObject({ unavailable: false });
      const connectionsBefore = opened;

      stalled = true;
      const first = await timed();
      expect(first.unavailable).toBe(true);
      expect(first.ms).toBeGreaterThan(1_500);
      const second = await timed();
      expect(second.unavailable).toBe(true);
      expect(second.ms).toBeLessThan(500);

      stalled = false;
      let recovered = await timed();
      for (let attempt = 0; recovered.unavailable && attempt < 100; attempt += 1) {
        await Bun.sleep(100);
        recovered = await timed();
      }
      expect(recovered.unavailable).toBe(false);
      expect(opened).toBeGreaterThan(connectionsBefore);
    });
  },
);
