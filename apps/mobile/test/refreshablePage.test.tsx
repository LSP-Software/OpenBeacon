import { expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
const fetched: string[] = [];
const testClient = new QueryClient();
mock.module("react-native", () => ({
  RefreshControl: (props: { onRefresh: () => Promise<void> }) =>
    React.createElement("refresh-control", props),
  ScrollView: ({
    children,
    refreshControl,
  }: {
    children?: React.ReactNode;
    refreshControl: React.ReactNode;
  }) => (
    <>
      {refreshControl}
      {children}
    </>
  ),
}));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../lib/api.ts", () => ({ queryClient: testClient }));

const { RefreshablePage } = await import("../components/RefreshablePage.tsx");

const query = (key: string) => ({
  queryKey: [key],
  queryFn: async () => {
    fetched.push(key);
    return key;
  },
});

const OnScreen = () => {
  useQuery(query("onScreen"));
  return null;
};

test("pulling to refresh refetches what the screen shows, not every cached query", async () => {
  await testClient.fetchQuery(query("elsewhere"));
  const root = createRoot();
  await act(async () =>
    root.render(
      <QueryClientProvider client={testClient}>
        <RefreshablePage>
          <OnScreen />
        </RefreshablePage>
      </QueryClientProvider>,
    ),
  );
  fetched.length = 0;
  const [control] = root.container.queryAll((item) => item.type === "refresh-control");
  await act(async () => (control!.props as { onRefresh: () => Promise<void> }).onRefresh());
  await act(async () => root.unmount());

  expect(fetched).toEqual(["onScreen"]);
});
