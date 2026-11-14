import { afterEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const appState = { currentState: "active" };
const appStateListeners = new Set<(state: string) => void>();

mock.module("react-native", () => ({
  AppState: {
    get currentState() {
      return appState.currentState;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    },
  },
}));

const { useAppForeground } = await import("./useAppForeground.ts");

const Listener = ({ onForeground }: { onForeground: () => void }) => {
  useAppForeground(onForeground);
  return null;
};

let root: Root | null = null;

const render = async (onForeground: () => void) => {
  root ??= createRoot();
  await act(async () => root?.render(<Listener onForeground={onForeground} />));
};

const changeTo = (state: string) =>
  act(() => {
    appState.currentState = state;
    for (const listener of appStateListeners) listener(state);
  });

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  appState.currentState = "active";
});

test("runs when the app comes back from the background or an inactive state", async () => {
  const onForeground = mock(() => {});
  await render(onForeground);

  await changeTo("background");
  await changeTo("active");
  await changeTo("inactive");
  await changeTo("active");

  expect(onForeground).toHaveBeenCalledTimes(2);
});

test("does not run on mount or when the app first becomes active from an unknown state", async () => {
  appState.currentState = "unknown";
  const onForeground = mock(() => {});
  await render(onForeground);

  await changeTo("active");

  expect(onForeground).not.toHaveBeenCalled();
});

test("ignores repeated active events while the app stays open", async () => {
  const onForeground = mock(() => {});
  await render(onForeground);

  await changeTo("active");
  await changeTo("active");

  expect(onForeground).not.toHaveBeenCalled();
});

test("calls the latest callback without subscribing again", async () => {
  const first = mock(() => {});
  const second = mock(() => {});
  await render(first);
  await render(second);

  expect(appStateListeners.size).toBe(1);
  await changeTo("background");
  await changeTo("active");

  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});

test("stops listening on unmount", async () => {
  await render(() => {});
  await act(async () => root?.unmount());
  root = null;

  expect(appStateListeners.size).toBe(0);
});
