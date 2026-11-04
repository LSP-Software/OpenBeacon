import { afterEach, expect, mock, test } from "bun:test";

let serverUrl = "";
mock.module("./server-url.ts", () => ({ getServerUrl: () => serverUrl }));

const { getBaseUrl } = await import("./base-url.ts");
const originalDevUrl = process.env.EXPO_PUBLIC_DEV_API_URL;

afterEach(() => {
  serverUrl = "";
  if (originalDevUrl === undefined) delete process.env.EXPO_PUBLIC_DEV_API_URL;
  else process.env.EXPO_PUBLIC_DEV_API_URL = originalDevUrl;
});

test("uses the hosted API by default", () => {
  delete process.env.EXPO_PUBLIC_DEV_API_URL;
  expect(getBaseUrl()).toBe("https://api.openbeacon.net");
});

test("uses a saved custom server", () => {
  delete process.env.EXPO_PUBLIC_DEV_API_URL;
  serverUrl = "https://self-hosted.example";
  expect(getBaseUrl()).toBe(serverUrl);
});

test("gives the development override precedence", () => {
  process.env.EXPO_PUBLIC_DEV_API_URL = "http://localhost:3000";
  serverUrl = "https://self-hosted.example";
  expect(getBaseUrl()).toBe("http://localhost:3000");
});
