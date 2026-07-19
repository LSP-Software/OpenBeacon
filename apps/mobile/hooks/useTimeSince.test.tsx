import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import React, { act, useState } from "react";
import { createRoot, type Root } from "test-renderer";
import { useTimeSince } from "./useTimeSince.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let latestLabel = "";
let scheduledCallbacks: Array<{ callback: () => void; delay: number }> = [];
let originalClearTimeout: typeof clearTimeout;
let originalSetTimeout: typeof setTimeout;
let nowMs = Date.parse("2026-07-19T12:00:00.000Z");
let originalDateNow: typeof Date.now;

const renderUseTimeSince = async (timestamp: string) => {
  const Harness = ({ value }: { value: string }) => {
    latestLabel = useTimeSince(value);
    return null;
  };

  if (!root) {
    root = createRoot();
  }

  await act(async () => {
    root?.render(<Harness value={timestamp} />);
    await Promise.resolve();
  });
};

describe("useTimeSince", () => {
  beforeEach(() => {
    latestLabel = "";
    scheduledCallbacks = [];
    nowMs = Date.parse("2026-07-19T12:00:00.000Z");
    originalDateNow = Date.now;
    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;
    Date.now = () => nowMs;
    globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
      const handle = { callback: callback as () => void, delay: delay ?? 0 };
      scheduledCallbacks.push(handle);
      return handle as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
      scheduledCallbacks = scheduledCallbacks.filter((entry) => entry !== (timer as never));
    }) as typeof clearTimeout;
  });

  afterEach(async () => {
    Date.now = originalDateNow;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (root) {
      await act(async () => {
        root?.unmount();
        await Promise.resolve();
      });
      root = null;
    }
  });

  test("advances the age label without new tracking data", async () => {
    const timestamp = new Date(nowMs - 59_000).toISOString();

    await renderUseTimeSince(timestamp);

    expect(latestLabel).toBe("59 seconds ago");
    expect(scheduledCallbacks).toHaveLength(1);
    expect(scheduledCallbacks[0]?.delay).toBe(1_000);

    nowMs += 1_000;
    await act(async () => {
      scheduledCallbacks[0]?.callback();
      await Promise.resolve();
    });

    expect(latestLabel).toBe("1 minute ago");
    expect(scheduledCallbacks.at(-1)?.delay).toBe(60_000);
  });

  test("clears the refresh timer on unmount", async () => {
    const timestamp = new Date(nowMs - 5_000).toISOString();
    let clearCount = 0;
    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
      clearCount += 1;
      scheduledCallbacks = scheduledCallbacks.filter((entry) => entry !== (timer as never));
    }) as typeof clearTimeout;

    const Inner = () => {
      latestLabel = useTimeSince(timestamp);
      return null;
    };

    const Harness = () => {
      const [mounted, setMounted] = useState(true);
      return (
        <>
          {mounted ? <Inner /> : null}
          <button
            onClick={() => {
              setMounted(false);
            }}
            type="button"
          >
            Unmount
          </button>
        </>
      );
    };

    root = createRoot();
    await act(async () => {
      root?.render(<Harness />);
      await Promise.resolve();
    });

    expect(scheduledCallbacks).toHaveLength(1);

    const button = root.container.queryAll((instance) => instance.type === "button")[0];
    await act(async () => {
      (button?.props as { onClick?: () => void }).onClick?.();
      await Promise.resolve();
    });

    expect(clearCount).toBeGreaterThan(0);
    expect(scheduledCallbacks).toHaveLength(0);
  });
});
