import { describe, expect, test } from "bun:test";
import {
  createProgressTracker,
  createRateLimiter,
  formatBytes,
  formatDuration,
  formatMbps,
} from "./transfer.ts";

const createClock = () => {
  let time = 0;
  const sleeps: number[] = [];

  return {
    advance: (ms: number) => {
      time += ms;
    },
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
    sleeps,
  };
};

describe("createRateLimiter", () => {
  test("does not wait without a limit", async () => {
    const clock = createClock();
    const limiter = createRateLimiter({ bytesPerSecond: null, ...clock });

    await limiter.take(1_000_000);

    expect(clock.sleeps).toEqual([]);
  });

  test("holds sequential transfers to the configured rate", async () => {
    const clock = createClock();
    const limiter = createRateLimiter({ bytesPerSecond: 1000, ...clock });

    for (let index = 0; index < 10; index += 1) {
      await limiter.take(500);
    }

    expect(clock.now()).toBe(5000);
  });

  test("shares the rate between concurrent transfers", async () => {
    let time = 0;
    const waits: number[] = [];
    const limiter = createRateLimiter({
      bytesPerSecond: 1000,
      now: () => time,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    await Promise.all([limiter.take(1000), limiter.take(1000), limiter.take(1000)]);

    expect(waits).toEqual([1000, 2000, 3000]);
  });

  test("does not bank unused bandwidth while idle", async () => {
    const clock = createClock();
    const limiter = createRateLimiter({ bytesPerSecond: 1000, ...clock });

    clock.advance(60_000);
    await limiter.take(1000);

    expect(clock.sleeps).toEqual([1000]);
  });
});

describe("createProgressTracker", () => {
  test("has no speed or ETA until enough time has passed", () => {
    const clock = createClock();
    const tracker = createProgressTracker({ now: clock.now });

    clock.advance(1000);
    tracker.transferred(1000);

    expect(tracker.snapshot({ doneBytes: 1000, totalBytes: 10_000 })).toEqual({
      bytesPerSecond: null,
      etaSeconds: null,
      percent: 10,
    });
  });

  test("estimates the remaining time from the recent speed", () => {
    const clock = createClock();
    const tracker = createProgressTracker({ now: clock.now });

    for (let second = 0; second < 10; second += 1) {
      clock.advance(1000);
      tracker.transferred(1000);
    }

    expect(tracker.snapshot({ doneBytes: 10_000, totalBytes: 100_000 })).toEqual({
      bytesPerSecond: 1000,
      etaSeconds: 90,
      percent: 10,
    });
  });

  test("adjusts the ETA when the speed changes", () => {
    const clock = createClock();
    const tracker = createProgressTracker({ now: clock.now, windowMs: 10_000 });

    for (let second = 0; second < 20; second += 1) {
      clock.advance(1000);
      tracker.transferred(1000);
    }
    for (let second = 0; second < 10; second += 1) {
      clock.advance(1000);
      tracker.transferred(4000);
    }

    expect(tracker.snapshot({ doneBytes: 60_000, totalBytes: 100_000 })).toEqual({
      bytesPerSecond: 4000,
      etaSeconds: 10,
      percent: 60,
    });
  });
});

describe("formatting", () => {
  test("formats sizes, rates and durations", () => {
    expect(formatBytes(139_356_959_640)).toBe("129.8 GiB");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatMbps(2_500_000)).toBe("20.0 Mbps");
    expect(formatDuration(55_738)).toBe("15h 28m");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(0.2)).toBe("1s");
  });
});
