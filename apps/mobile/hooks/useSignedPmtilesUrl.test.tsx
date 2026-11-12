import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import {
  environmentManager,
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let fetches = 0;
let screenFocused = true;
let requestedArchiveIds: (string | undefined)[] = [];

mock.module("@react-navigation/native", () => ({
  useIsFocused: () => screenFocused,
}));

mock.module("../lib/api.ts", () => ({
  queryClient: {
    getQueryData: (queryKey: unknown[]) => queryClient.getQueryData(queryKey),
  },
  trpc: {
    maps: {
      getSignedPmtilesUrl: {
        queryOptions: () => ({
          queryKey: [["maps", "getSignedPmtilesUrl"], { type: "query" }],
        }),
      },
    },
  },
  trpcClient: {
    maps: {
      getSignedPmtilesUrl: {
        query: async (input: { archiveId: string | undefined }) => {
          fetches += 1;
          requestedArchiveIds.push(input.archiveId);
          return {
            archiveId: "a-20261107",
            mapBuild: "20261107",
            mapSlot: "a" as const,
            expiresAt: new Date(Date.now() + 90_000).toISOString(),
            refreshAt: new Date(Date.now() + 30_000).toISOString(),
            url: `https://example.com/map.pmtiles?signature=${fetches}`,
          };
        },
      },
    },
  },
}));

const { useSignedPmtilesUrl }: typeof import("./useSignedPmtilesUrl.ts") =
  await import("./useSignedPmtilesUrl.ts");

let root: Root | null = null;
let queryClient: QueryClient;

const Harness = () => {
  useSignedPmtilesUrl();
  return null;
};

const render = async () => {
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
  });
  await settle();
};

const settle = async () => {
  await act(async () => {
    for (let index = 0; index < 10; index++) await Promise.resolve();
  });
};

const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
};

describe("useSignedPmtilesUrl", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    environmentManager.setIsServer(() => false);
    fetches = 0;
    requestedArchiveIds = [];
    screenFocused = true;
    focusManager.setFocused(true);
    queryClient = new QueryClient();
    root = createRoot();
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    queryClient.clear();
    focusManager.setFocused(undefined);
    environmentManager.setIsServer(() => typeof window === "undefined");
    jest.useRealTimers();
  });

  test("refreshes the URL when refreshAt arrives while the map is open", async () => {
    await render();
    expect(fetches).toBe(1);

    await advance(29_000);
    expect(fetches).toBe(1);
    await advance(1_000);

    expect(fetches).toBe(2);
  });

  test("doesn't refresh in the background, and refreshes once on return", async () => {
    await render();
    await act(async () => {
      focusManager.setFocused(false);
    });

    await advance(120_000);
    expect(fetches).toBe(1);

    await act(async () => {
      focusManager.setFocused(true);
    });
    await settle();

    expect(fetches).toBe(2);
  });

  test("doesn't refresh while the map tab is hidden, and refreshes once it's shown again", async () => {
    await render();
    screenFocused = false;
    await render();

    await advance(120_000);
    expect(fetches).toBe(1);

    screenFocused = true;
    await render();

    expect(fetches).toBe(2);
  });

  test("returning before refreshAt doesn't fetch again", async () => {
    await render();
    await act(async () => {
      focusManager.setFocused(false);
    });
    await advance(10_000);
    await act(async () => {
      focusManager.setFocused(true);
    });
    await settle();

    expect(fetches).toBe(1);
  });

  test("requests the archive the map already uses so refreshes never switch archives", async () => {
    await render();
    await advance(30_000);

    expect(requestedArchiveIds).toEqual([undefined, "a-20261107"]);
  });
});
