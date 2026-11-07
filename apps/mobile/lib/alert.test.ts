import { expect, test } from "bun:test";
import { Alert, dismissAlert, getSnapshot, subscribe } from "./alert.ts";

test("queues alerts in order and notifies subscribers as they are dismissed", () => {
  let notifications = 0;
  const unsubscribe = subscribe(() => {
    notifications += 1;
  });
  const onPress = () => {};
  Alert.alert("First", "Message", [{ text: "Continue", onPress }]);
  Alert.alert("Second");
  expect(getSnapshot().map((alert) => alert.title)).toEqual(["First", "Second"]);
  expect(getSnapshot()[0]?.buttons[0]?.onPress).toBe(onPress);
  dismissAlert();
  expect(getSnapshot()[0]?.buttons).toEqual([{ text: "OK" }]);
  dismissAlert();
  expect(getSnapshot()).toEqual([]);
  expect(notifications).toBe(4);
  unsubscribe();
});
