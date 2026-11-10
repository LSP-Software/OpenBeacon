import { afterEach, beforeEach, expect, jest, mock, test } from "bun:test";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let isFocused = true;
mock.module("@react-navigation/native", () => ({ useIsFocused: () => isFocused }));

const { useRefetchWhileFocused } = await import("./useRefetchWhileFocused.ts");

const queryClient = new QueryClient();
const refetchQueries = mock<QueryClient["refetchQueries"]>(async () => {});
queryClient.refetchQueries = refetchQueries;

const Screen = () => {
  useRefetchWhileFocused([["groups"], ["invites"]], 10_000);
  return null;
};

const renderScreen = async () => {
  const root = createRoot();
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Screen />
      </QueryClientProvider>,
    ),
  );
  return root;
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  isFocused = true;
  focusManager.setFocused(undefined);
  refetchQueries.mockClear();
});

test("refreshes every key on each tick without cancelling fetches already in flight", async () => {
  const root = await renderScreen();

  jest.advanceTimersByTime(9_999);
  expect(refetchQueries).not.toHaveBeenCalled();

  jest.advanceTimersByTime(1);
  jest.advanceTimersByTime(10_000);
  expect(refetchQueries.mock.calls).toEqual([
    [{ queryKey: ["groups"], type: "active" }, { cancelRefetch: false }],
    [{ queryKey: ["invites"], type: "active" }, { cancelRefetch: false }],
    [{ queryKey: ["groups"], type: "active" }, { cancelRefetch: false }],
    [{ queryKey: ["invites"], type: "active" }, { cancelRefetch: false }],
  ]);

  await act(async () => root.unmount());
  jest.advanceTimersByTime(10_000);
  expect(refetchQueries).toHaveBeenCalledTimes(4);
});

test("refreshes nothing while the screen is hidden", async () => {
  isFocused = false;
  const root = await renderScreen();
  jest.advanceTimersByTime(30_000);
  expect(refetchQueries).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

test("refreshes nothing while the app is in the background", async () => {
  focusManager.setFocused(false);
  const root = await renderScreen();
  jest.advanceTimersByTime(30_000);
  expect(refetchQueries).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
