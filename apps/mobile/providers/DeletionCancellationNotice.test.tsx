import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let listener: ((state: string) => void) | undefined;
let button: (() => void) | undefined;
let failCheck = false;
let failAcknowledgement = false;
const check = mock(async () => {
  if (failCheck) throw new Error("offline");
  return { cancelled: true };
});
const acknowledge = mock(async (_input: { userId: string }) => {
  if (failAcknowledgement) throw new Error("offline");
});
const alert = mock((_title: string, _message: string, buttons: { onPress: () => void }[]) => {
  button = buttons[0]?.onPress;
});
mock.module("../lib/alert.ts", () => ({ Alert: { alert } }));
mock.module("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, callback: (state: string) => void) => {
      listener = callback;
      return {
        remove: () => {
          listener = undefined;
        },
      };
    },
  },
}));
mock.module("../lib/api.ts", () => ({
  trpcClient: {
    account: {
      deletionCancellationNotice: { query: check },
      acknowledgeDeletionCancellation: { mutate: acknowledge },
    },
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));
const { DeletionCancellationNotice } = await import("./DeletionCancellationNotice.tsx");
let root: Root | null = null;
const flush = async () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

beforeEach(() => {
  failCheck = false;
  failAcknowledgement = false;
  button = undefined;
  check.mockClear();
  acknowledge.mockClear();
  alert.mockClear();
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

test("retries a failed notice check and acknowledges only after display", async () => {
  failCheck = true;
  await act(async () => {
    root = createRoot();
    root.render(<DeletionCancellationNotice />);
  });
  await flush();
  expect(alert).not.toHaveBeenCalled();
  expect(acknowledge).not.toHaveBeenCalled();
  failCheck = false;
  await act(async () => {
    listener?.("active");
  });
  await flush();
  expect(alert).toHaveBeenCalledTimes(1);
  expect(acknowledge).not.toHaveBeenCalled();
  await act(async () => {
    button?.();
  });
  await flush();
  expect(acknowledge).toHaveBeenCalledWith({ userId: "user-1" });
});

test("shows the notice again when acknowledgement fails", async () => {
  failAcknowledgement = true;
  await act(async () => {
    root = createRoot();
    root.render(<DeletionCancellationNotice />);
  });
  await flush();
  await act(async () => {
    button?.();
  });
  await flush();
  expect(acknowledge).toHaveBeenCalledTimes(1);
  failAcknowledgement = false;
  await act(async () => {
    listener?.("active");
  });
  await flush();
  expect(alert).toHaveBeenCalledTimes(2);
  await act(async () => {
    button?.();
  });
  await flush();
  expect(acknowledge).toHaveBeenCalledTimes(2);
});
