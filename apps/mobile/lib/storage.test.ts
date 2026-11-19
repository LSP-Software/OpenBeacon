import { expect, mock, test } from "bun:test";

const values = new Map<string, number>();

mock.module("react-native-mmkv", () => ({
  createMMKV: () => ({
    getNumber: (key: string) => values.get(key),
    set: (key: string, value: number) => {
      values.set(key, value);
    },
  }),
}));

test("the first launch records which storage layout the app writes", async () => {
  await import("./storage.ts");
  expect(Object.fromEntries(values)).toEqual({ "storage.schemaVersion": 1 });
});
