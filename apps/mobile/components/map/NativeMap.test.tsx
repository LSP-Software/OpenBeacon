import { beforeEach, describe, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let currentSignedPmtilesUrlQuery: {
  data?: {
    expiresAt: string;
    refreshAt: string;
    url: string;
  } | null;
  error?: {
    data?: {
      code?: string;
    };
  } | null;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  refetch: () => Promise<void>;
};
let forceRefreshMutationState: {
  isPending: boolean;
  mutate: () => void;
};
let forceRefreshMutationCalls = 0;
let mapViewProps: {
  onDidFailLoadingMap?: () => void;
  onDidFinishLoadingStyle?: () => void;
} | null = null;
const setQueryData = mock(() => {});

mock.module("react-native", () => ({
  Button: ({ onPress, title }: { onPress?: () => void; title: string }) =>
    React.createElement("button", { onClick: onPress, type: "button" }, title),
  Platform: {
    OS: "ios",
  },
  View: ({ children }: { children: React.ReactNode }) =>
    React.createElement("view", null, children),
}));

mock.module("@tanstack/react-query", () => ({
  useQuery: () => currentSignedPmtilesUrlQuery,
  useMutation: (options: { onSuccess?: (data: unknown) => void }) => {
    forceRefreshMutationState = {
      isPending: false,
      mutate: () => {
        forceRefreshMutationCalls += 1;
        options.onSuccess?.({
          expiresAt: "2026-03-31T12:20:00.000Z",
          refreshAt: "2026-03-31T12:19:00.000Z",
          url: "https://forced.example/pmtiles",
        });
      },
    };

    return forceRefreshMutationState;
  },
}));

mock.module("@maplibre/maplibre-react-native", () => ({
  Camera: () => React.createElement("camera"),
  MapView: ({
    children,
    onDidFailLoadingMap,
    onDidFinishLoadingStyle,
  }: {
    children: React.ReactNode;
    onDidFailLoadingMap?: () => void;
    onDidFinishLoadingStyle?: () => void;
  }) => {
    mapViewProps = {
      ...(onDidFailLoadingMap ? { onDidFailLoadingMap } : {}),
      ...(onDidFinishLoadingStyle ? { onDidFinishLoadingStyle } : {}),
    };

    return React.createElement("map-view", null, children);
  },
}));

mock.module("expo-router", () => ({
  router: {
    replace: () => {},
  },
  useRootNavigationState: () => ({
    key: "root",
  }),
}));

mock.module("../../components/ui/Text.tsx", () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement("text", null, children),
}));

mock.module("../../hooks/useSignedPmtilesUrl.ts", () => ({
  useSignedPmtilesUrl: () => currentSignedPmtilesUrlQuery,
}));

mock.module("../../lib/api.ts", () => ({
  queryClient: {
    setQueryData,
  },
  trpc: {
    maps: {
      forceRefreshSignedPmtilesUrl: {
        mutationOptions: () => ({}),
      },
      getSignedPmtilesUrl: {
        queryKey: () => [["maps", "getSignedPmtilesUrl"]],
      },
    },
  },
}));

mock.module("../../lib/protomaps-style.ts", () => ({
  getProtomapsMapStyle: (_theme: "light" | "dark", pmtilesUrl: string) => ({
    pmtilesUrl,
    version: 8,
  }),
}));

mock.module("../../providers/ThemeProvider.tsx", () => ({
  useTheme: () => ({
    mapTheme: "light" as const,
  }),
}));

const { NativeMap }: typeof import("./NativeMap.tsx") = await import("./NativeMap.tsx");

describe("NativeMap", () => {
  beforeEach(() => {
    currentSignedPmtilesUrlQuery = {
      data: {
        expiresAt: "2026-03-31T12:10:00.000Z",
        refreshAt: "2026-03-31T12:09:00.000Z",
        url: "https://cached.example/pmtiles-1",
      },
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: async () => {},
    };
    forceRefreshMutationState = {
      isPending: false,
      mutate: () => {},
    };
    forceRefreshMutationCalls = 0;
    mapViewProps = null;
    setQueryData.mockReset();
  });

  test("forces one refresh per url after map failures and resets when the url changes", async () => {
    const root = createRoot();

    await act(async () => {
      root.render(<NativeMap />);
      await Promise.resolve();
    });

    mapViewProps?.onDidFailLoadingMap?.();
    mapViewProps?.onDidFailLoadingMap?.();

    expect(forceRefreshMutationCalls).toBe(1);
    expect(setQueryData).toHaveBeenCalledWith(
      [["maps", "getSignedPmtilesUrl"]],
      expect.objectContaining({
        url: "https://forced.example/pmtiles",
      }),
    );

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        expiresAt: "2026-03-31T12:30:00.000Z",
        refreshAt: "2026-03-31T12:29:00.000Z",
        url: "https://cached.example/pmtiles-2",
      },
    };

    await act(async () => {
      root.render(<NativeMap />);
      await Promise.resolve();
    });

    mapViewProps?.onDidFailLoadingMap?.();

    expect(forceRefreshMutationCalls).toBe(2);
  });
});
