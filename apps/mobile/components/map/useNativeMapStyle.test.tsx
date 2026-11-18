import { afterEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type LogEvent = { level: string; message: string; tag: string };

const nativeTransforms = new Map<string, { find: string; replace: string }>();
let nativeLogHandler: (log: LogEvent) => boolean = () => false;

mock.module("@maplibre/maplibre-react-native", () => ({
  LogManager: {
    onLog: (handler: (log: LogEvent) => boolean) => {
      nativeLogHandler = handler;
    },
  },
  TransformRequestManager: {
    addUrlTransform: ({ id, find, replace }: { id: string; find: string; replace: string }) => {
      nativeTransforms.set(id, { find, replace });
    },
    removeUrlTransform: (id: string) => {
      nativeTransforms.delete(id);
    },
  },
}));
mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));
mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({ isPaused: false, isPending: false, mutate: () => {} }),
}));
mock.module("expo-file-system", () => ({ Paths: { bundle: { uri: "file:///app" } } }));
mock.module("expo-router", () => ({
  router: { replace: () => {} },
  useRootNavigationState: () => ({ key: "root" }),
}));
mock.module("react-native", () => ({ Platform: { OS: "android" } }));
mock.module("../../hooks/useSignedPmtilesUrl.ts", () => ({
  useSignedPmtilesUrl: () => ({
    data: {
      archiveId: "archive-1",
      url: "https://tiles.example/map.pmtiles?X-Amz-Signature=one",
    },
    error: null,
    failureCount: 0,
    failureReason: null,
    isError: false,
    isFetching: false,
    isLoading: false,
    isPaused: false,
    refetch: async () => {},
  }),
}));
mock.module("../../lib/api.ts", () => ({
  queryClient: { setQueryData: () => {} },
  trpc: {
    maps: {
      forceRefreshSignedPmtilesUrl: { mutationOptions: () => ({}) },
      getSignedPmtilesUrl: { queryKey: () => [] },
    },
  },
}));
mock.module("../../lib/mapCache.ts", () => ({
  clearCachedMapTiles: async () => {},
  prepareMapCache: async () => {},
  readLastMapSource: () => null,
  saveLastMapSource: () => {},
}));
mock.module("../../lib/protomaps-style.ts", () => ({
  getProtomapsMapStyle: (_theme: string, sourceUrl: string) => ({ layers: [], sourceUrl }),
  getSymbolLayerIds: () => [],
}));
mock.module("../../lib/storage.ts", () => ({
  storage: { getBoolean: () => undefined, set: () => {} },
}));
mock.module("../../providers/ThemeProvider.tsx", () => ({
  useTheme: () => ({ mapTheme: "light" }),
}));

const { useNativeMapStyle } = await import("./useNativeMapStyle.ts");

const screens = new Map<string, ReturnType<typeof useNativeMapStyle>>();
const Screen = ({ name }: { name: string }) => {
  screens.set(name, useNativeMapStyle());
  return null;
};

const mountScreen = async (name: string) => {
  const root = createRoot();
  await act(async () => root.render(<Screen name={name} />));
  return root;
};

const tileRequestUrl = (url: string) =>
  [...nativeTransforms.values()].reduce(
    (current, { find, replace }) => current.replace(new RegExp(find), replace),
    url,
  );

const pmtilesFailure = {
  level: "error",
  message: "[Style]: Failed to load source protomaps: Error fetching PMTiles header: 403",
  tag: "Mbgl",
};

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  screens.clear();
});

test("closing a second map screen keeps the live map's tile signing and failure handling", async () => {
  roots.push(await mountScreen("live"));
  const timeline = await mountScreen("timeline");
  await act(async () => timeline.unmount());

  const sourceUrl = screens.get("live")?.pmtilesUrl;
  expect(sourceUrl).toBe("https://tiles.example/map.pmtiles?archive=archive-1");
  expect(tileRequestUrl(sourceUrl ?? "")).toBe(
    "https://tiles.example/map.pmtiles?X-Amz-Signature=one",
  );

  let handled = false;
  await act(async () => {
    handled = nativeLogHandler(pmtilesFailure);
  });
  expect(handled).toBe(true);
  expect(screens.get("live")?.showRecoverableError).toBe(true);
});

test("removes the tile signing once the last map screen closes", async () => {
  const live = await mountScreen("live");
  const timeline = await mountScreen("timeline");
  await act(async () => timeline.unmount());
  expect(nativeTransforms.size).toBe(1);

  await act(async () => live.unmount());

  expect(nativeTransforms.size).toBe(0);
  expect(nativeLogHandler(pmtilesFailure)).toBe(false);
});

test("a map failure goes to the screen on top while both are open", async () => {
  roots.push(await mountScreen("live"));
  roots.push(await mountScreen("timeline"));

  await act(async () => {
    nativeLogHandler(pmtilesFailure);
  });

  expect(screens.get("timeline")?.showRecoverableError).toBe(true);
  expect(screens.get("live")?.showRecoverableError).toBe(false);
});
