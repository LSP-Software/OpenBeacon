import { describe, expect, test } from "bun:test";
import { watchPositionWithLastKnown } from "./watchPositionWithLastKnown.ts";

type Position = { label: string; timestamp: number };

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
};

const flushAsync = async () => {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
};

const start = ({
  lastKnown,
  wanted = () => true,
  watchResult = Promise.resolve({ remove: () => undefined }),
}: {
  lastKnown: Promise<Position | null>;
  wanted?: () => boolean;
  watchResult?: Promise<{ remove: () => void }>;
}) => {
  const delivered: string[] = [];
  let emitWatch: (position: Position) => void = () => undefined;
  const subscription = watchPositionWithLastKnown<Position>({
    getLastKnownPosition: () => lastKnown,
    isWanted: wanted,
    onPosition: (position) => delivered.push(position.label),
    watchPosition: (onPosition) => {
      emitWatch = onPosition;
      return watchResult;
    },
  });
  return { delivered, emitWatch: (position: Position) => emitWatch(position), subscription };
};

describe("watchPositionWithLastKnown", () => {
  test("shows the last known position before the first watch fix arrives", async () => {
    const watch = deferred<{ remove: () => void }>();
    const { delivered, emitWatch } = start({
      lastKnown: Promise.resolve({ label: "cached", timestamp: 1_000 }),
      watchResult: watch.promise,
    });

    await flushAsync();
    expect(delivered).toEqual(["cached"]);

    watch.resolve({ remove: () => undefined });
    emitWatch({ label: "fix", timestamp: 2_000 });
    expect(delivered).toEqual(["cached", "fix"]);
  });

  test("ignores a last known position that resolves after a newer watch fix", async () => {
    const lastKnown = deferred<Position | null>();
    const { delivered, emitWatch, subscription } = start({ lastKnown: lastKnown.promise });

    await subscription;
    emitWatch({ label: "fix", timestamp: 2_000 });
    lastKnown.resolve({ label: "cached", timestamp: 1_000 });
    await flushAsync();

    expect(delivered).toEqual(["fix"]);
  });

  test("waits for the watch when there is no usable last known position", async () => {
    const { delivered, emitWatch, subscription } = start({ lastKnown: Promise.resolve(null) });

    await subscription;
    await flushAsync();
    expect(delivered).toEqual([]);

    emitWatch({ label: "fix", timestamp: 2_000 });
    expect(delivered).toEqual(["fix"]);
  });

  test("still watches when reading the last known position fails", async () => {
    const { delivered, emitWatch, subscription } = start({
      lastKnown: Promise.reject(new Error("unavailable")),
    });

    await subscription;
    await flushAsync();
    emitWatch({ label: "fix", timestamp: 2_000 });

    expect(delivered).toEqual(["fix"]);
  });

  test("drops a last known position that arrives once the watch is no longer wanted", async () => {
    const lastKnown = deferred<Position | null>();
    let wanted = true;
    const { delivered } = start({ lastKnown: lastKnown.promise, wanted: () => wanted });

    wanted = false;
    lastKnown.resolve({ label: "cached", timestamp: 1_000 });
    await flushAsync();

    expect(delivered).toEqual([]);
  });

  test("stops delivering after the subscription is removed", async () => {
    let removed = 0;
    const lastKnown = deferred<Position | null>();
    const { delivered, emitWatch, subscription } = start({
      lastKnown: lastKnown.promise,
      watchResult: Promise.resolve({
        remove: () => {
          removed += 1;
        },
      }),
    });

    (await subscription).remove();
    lastKnown.resolve({ label: "cached", timestamp: 1_000 });
    emitWatch({ label: "fix", timestamp: 2_000 });
    await flushAsync();

    expect(removed).toBe(1);
    expect(delivered).toEqual([]);
  });

  test("drops the last known position when the watch cannot start", async () => {
    const lastKnown = deferred<Position | null>();
    const { delivered, subscription } = start({
      lastKnown: lastKnown.promise,
      watchResult: Promise.reject(new Error("location off")),
    });

    await expect(subscription).rejects.toThrow("location off");
    lastKnown.resolve({ label: "cached", timestamp: 1_000 });
    await flushAsync();

    expect(delivered).toEqual([]);
  });
});
