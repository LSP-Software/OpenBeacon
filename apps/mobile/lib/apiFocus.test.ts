import { expect, mock, test } from "bun:test";
import { focusManager } from "@tanstack/react-query";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

const listeners = new Set<(state: string) => void>();

mock.module("react-native", () =>
  createReactNativeTestModule({
    appState: {
      currentState: "background",
      addEventListener: (_event, listener) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      },
    },
  }),
);
mock.module("./storage.ts", () => ({
  storage: { getString: () => undefined, set: () => {}, remove: () => {}, contains: () => false },
}));
mock.module("./currentServer.ts", () => ({
  baseUrl: "http://127.0.0.1",
  getFeedbackUrl: () => "http://127.0.0.1",
}));
mock.module("./auth-client.ts", () => ({ authClient: { getCookie: () => null } }));

await import("./api.ts");

const changeAppState = (state: string) => {
  for (const listener of listeners) {
    listener(state);
  }
};

test("focus starts from the app state the app launched in", () => {
  expect(focusManager.isFocused()).toBe(false);
});

test("focus is only lost when the app goes to the background", () => {
  changeAppState("active");
  expect(focusManager.isFocused()).toBe(true);

  changeAppState("inactive");
  expect(focusManager.isFocused()).toBe(true);

  changeAppState("background");
  expect(focusManager.isFocused()).toBe(false);
});
