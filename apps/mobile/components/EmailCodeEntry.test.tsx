import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import React, { act } from "react";
import { type Control, type FieldValues, useController } from "react-hook-form";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("react-native", () => ({
  View,
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    onPress?: () => void;
  }) => React.createElement("resend", { disabled: disabled ?? false, onPress }, children),
}));
mock.module("./ui/Text.tsx", () => ({ Text: View }));
mock.module("./ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("submit", { onPress }, children),
}));
mock.module("./ui/Input.tsx", () => ({
  Input: ({ control, name }: { control: Control<FieldValues>; name: string }) => {
    const { field, fieldState } = useController({ control, name });
    return React.createElement(
      "code-input",
      { onChangeText: field.onChange },
      fieldState.error?.message ?? null,
    );
  },
}));
mock.module("../lib/auth-client.ts", () => ({ authClient: { $fetch: () => undefined } }));

const { EmailCodeEntry } = await import("./EmailCodeEntry.tsx");
const { invalidCodeMessage } = await import("../lib/emailCodes.ts");

let root: Root | undefined;
let now = 0;
let timers: Array<() => void> = [];
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

beforeEach(() => {
  now = 1_000_000;
  spyOn(Date, "now").mockImplementation(() => now);
  globalThis.setTimeout = ((callback: () => void) => {
    timers.push(callback);
    return callback as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    timers = timers.filter((callback) => callback !== (timer as unknown as () => void));
  }) as typeof clearTimeout;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  timers = [];
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  mock.restore();
});

const renderEntry = async (onResend: () => Promise<string | undefined>) => {
  root = createRoot();
  await act(async () =>
    root?.render(
      <EmailCodeEntry
        email="me@example.com"
        submitLabel="Continue"
        onSubmit={async () => invalidCodeMessage}
        onResend={onResend}
      />,
    ),
  );
  const find = (type: string) => {
    const [element] = root?.container.queryAll((item) => item.type === type) ?? [];
    if (!element) throw new Error(`No ${type} rendered`);
    return element;
  };
  const rendered = () => JSON.stringify(root?.container.toJSON());
  const enterWrongCode = async () => {
    await act(async () =>
      (find("code-input").props["onChangeText"] as (code: string) => void)("123456"),
    );
    await act(async () => (find("submit").props["onPress"] as () => Promise<void>)());
  };
  const resend = async () => {
    now += 61_000;
    await act(async () => {
      const pending = timers;
      timers = [];
      for (const callback of pending) callback();
    });
    expect(rendered()).toContain('"Resend code"');
    expect(find("resend").props["disabled"]).toBe(false);
    await act(async () => (find("resend").props["onPress"] as () => Promise<void>)());
  };
  const resendDisabled = () => find("resend").props["disabled"] as boolean;
  return { rendered, enterWrongCode, resend, resendDisabled };
};

test("a successful resend clears the wrong code error and restarts the cooldown", async () => {
  const entry = await renderEntry(async () => undefined);
  await entry.enterWrongCode();
  expect(entry.rendered()).toContain(invalidCodeMessage);

  await entry.resend();

  expect(entry.rendered()).not.toContain(invalidCodeMessage);
  expect(entry.rendered()).toContain("We've sent a new code. Earlier codes no longer work.");
  expect(entry.rendered()).toContain("Resend code in 60s");
  expect(entry.resendDisabled()).toBe(true);
});

test("a refused resend clears the wrong code error and restarts the cooldown", async () => {
  const refused = "Too many codes have been requested. Try again in a few minutes.";
  const entry = await renderEntry(async () => refused);
  await entry.enterWrongCode();

  await entry.resend();

  expect(entry.rendered()).not.toContain(invalidCodeMessage);
  expect(entry.rendered()).toContain(refused);
  expect(entry.rendered()).toContain("Resend code in 60s");
  expect(entry.resendDisabled()).toBe(true);
});

test("the wait hint appears once a new code is rejected after an earlier one", async () => {
  const hint = "If new codes keep being rejected, wait a few hours and try again.";
  const entry = await renderEntry(async () => undefined);
  await entry.enterWrongCode();
  await entry.enterWrongCode();
  expect(entry.rendered()).not.toContain(hint);

  await entry.resend();
  await entry.enterWrongCode();

  expect(entry.rendered()).toContain(hint);
});
