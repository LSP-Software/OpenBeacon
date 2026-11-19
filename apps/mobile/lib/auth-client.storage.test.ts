import { afterEach, expect, jest, mock, test } from "bun:test";

let cookieStorage: {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
} | null = null;

mock.module("./storage.ts", () => ({
  storage: { getString: () => undefined, set: () => {}, remove: () => {}, contains: () => false },
}));
mock.module("./currentServer.ts", () => ({ getBaseUrl: () => "https://beacon.example" }));
mock.module("expo-secure-store", () => ({
  getItemAsync: () => new Promise(() => {}),
  setItemAsync: () => new Promise(() => {}),
}));
mock.module("@better-auth/expo/client", () => ({
  expoClient: (options: { storage: NonNullable<typeof cookieStorage> }) => {
    cookieStorage = options.storage;
    return { id: "expo" };
  },
}));

mock.module("expo-device", () => ({ DeviceType: { PHONE: 1, TABLET: 2 }, deviceType: 1 }));

await import("./auth-client.ts");
const { SECRET_STORAGE_UNAVAILABLE_MESSAGE } = await import("./secretStorage.ts");

afterEach(() => {
  jest.useRealTimers();
});

test("a cookie read that stalls in key storage gives up after 10 seconds", async () => {
  jest.useFakeTimers();
  const read = cookieStorage!.getItemAsync("openbeacon_cookie");
  const settled = read.then(
    () => "read",
    (error: Error) => error.message,
  );
  jest.advanceTimersByTime(9_999);
  await Promise.resolve();
  const early = await Promise.race([settled, Promise.resolve("waiting")]);
  jest.advanceTimersByTime(1);

  expect(early).toBe("waiting");
  expect(await settled).toBe(SECRET_STORAGE_UNAVAILABLE_MESSAGE);
});

test("a cookie write that stalls in key storage gives up after 10 seconds", async () => {
  jest.useFakeTimers();
  const write = cookieStorage!.setItemAsync("openbeacon_cookie", "{}");
  jest.advanceTimersByTime(10_000);

  await expect(write).rejects.toThrow(SECRET_STORAGE_UNAVAILABLE_MESSAGE);
});
