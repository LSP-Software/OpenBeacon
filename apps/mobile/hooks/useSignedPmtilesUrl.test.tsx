import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import TestRenderer, { act } from "react-test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let currentQuery: {
  data?: {
    expiresAt: string;
    refreshAt: string;
    url: string;
  };
  refetch: () => Promise<void>;
};
let lastTimeoutCallback: (() => void) | null = null;
let lastTimeoutDelay: number | null = null;
let originalClearTimeout: typeof clearTimeout;
let originalSetTimeout: typeof setTimeout;

mock.module("@tanstack/react-query", () => ({
  useQuery: () => currentQuery,
  useMutation: () => ({
    isPending: false,
    mutate: () => {},
  }),
}));

mock.module("/home/smadger/Desktop/Projects/OpenBeacon/apps/mobile/lib/api.ts", () => ({
  queryClient: {
    setQueryData: () => {},
  },
  trpc: {
    maps: {
      getSignedPmtilesUrl: {
        queryOptions: () => ({}),
      },
    },
  },
}));

const { useSignedPmtilesUrl }: typeof import("./useSignedPmtilesUrl.ts") = await import(
  "./useSignedPmtilesUrl.ts"
);

const renderHookHarness = async () => {
  const Harness = () => {
    useSignedPmtilesUrl();
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  await act(async () => {
    renderer = TestRenderer.create(<Harness />);
    await Promise.resolve();
  });

  if (renderer === null) {
    throw new Error("Renderer was not created");
  }

  return renderer;
};

describe("useSignedPmtilesUrl", () => {
  beforeEach(() => {
    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;
    lastTimeoutCallback = null;
    lastTimeoutDelay = null;
    globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
      lastTimeoutCallback = callback as () => void;
      lastTimeoutDelay = delay ?? 0;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((
      _timer: ReturnType<typeof setTimeout>,
    ) => {}) as typeof clearTimeout;
  });

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  test("schedules the next refetch from refreshAt", async () => {
    const refetch = mock(async () => {});
    currentQuery = {
      data: {
        expiresAt: "2026-03-31T12:10:00.000Z",
        refreshAt: "2026-03-31T12:09:00.000Z",
        url: "https://example.com/pmtiles",
      },
      refetch,
    };

    const now = new Date("2026-03-31T12:08:30.000Z").getTime();
    const originalNow = Date.now;
    Date.now = () => now;

    await renderHookHarness();

    Date.now = originalNow;

    expect(lastTimeoutDelay).toBe(30_000);
    expect(refetch).not.toHaveBeenCalled();
    lastTimeoutCallback?.();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test("refetches immediately when refreshAt is already due", async () => {
    const refetch = mock(async () => {});
    currentQuery = {
      data: {
        expiresAt: "2026-03-31T12:10:00.000Z",
        refreshAt: "2026-03-31T12:09:00.000Z",
        url: "https://example.com/pmtiles",
      },
      refetch,
    };
    const now = new Date("2026-03-31T12:09:00.000Z").getTime();
    const originalNow = Date.now;
    Date.now = () => now;

    await renderHookHarness();

    Date.now = originalNow;

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(lastTimeoutDelay).toBeNull();
  });
});
