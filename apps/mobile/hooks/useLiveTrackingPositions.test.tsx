import { afterEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const appState = { currentState: "active" };
const appStateListeners = new Set<(state: string) => void>();
const sessions: { active: boolean; destroyed: boolean; activatedAfterDestroy: boolean }[] = [];

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

mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));

mock.module("../lib/createDefaultMapTrackingDeps.ts", () => ({
  createDefaultMapTrackingDeps: () => ({ listGroups: async () => [] }),
}));

mock.module("../lib/mapTracking.ts", () => ({
  createMapTrackingSession: () => {
    const state = { active: false, destroyed: false, activatedAfterDestroy: false };
    sessions.push(state);
    return {
      destroy: () => {
        state.destroyed = true;
        state.active = false;
      },
      dropRemovedDevices: () => {},
      getLivePositions: () => [],
      getStatus: () => ({ connection: "ok", groups: {}, membership: "loading", undecryptable: [] }),
      setActive: (active: boolean) => {
        if (state.destroyed && active) state.activatedAfterDestroy = true;
        state.active = active;
      },
      subscribe: () => () => {},
    };
  },
}));

const { useLiveTrackingPositions } = await import("./useLiveTrackingPositions.ts");

const Probe = ({ groupId }: { groupId: string }) => {
  useLiveTrackingPositions({ groupId });
  return null;
};

let root: Root | null = null;

const render = async (groupId: string) => {
  root ??= createRoot();
  await act(async () => root?.render(<Probe groupId={groupId} />));
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
  sessions.length = 0;
});

test("follows the app state on the new session after the group changes", async () => {
  await render("group-a");
  await render("group-b");
  const [first, second] = sessions;

  await changeTo("background");
  expect(second?.active).toBe(false);

  await changeTo("active");
  expect(second?.active).toBe(true);
  expect(first?.activatedAfterDestroy).toBe(false);
});
