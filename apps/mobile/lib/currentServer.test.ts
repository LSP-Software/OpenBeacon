import { afterEach, describe, expect, mock, test } from "bun:test";

const stored = new Map<string, string>();
mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => stored.get(key),
    set: (key: string, value: string) => {
      stored.set(key, value);
    },
    remove: (key: string) => stored.delete(key),
  },
}));

const { getBaseUrl, getFeedbackUrl, getServerUrl, normaliseServerUrl, setServerUrl } =
  await import("./currentServer.ts");
const originalDevUrl = process.env.EXPO_PUBLIC_DEV_API_URL;

afterEach(() => {
  stored.clear();
  if (originalDevUrl === undefined) delete process.env.EXPO_PUBLIC_DEV_API_URL;
  else process.env.EXPO_PUBLIC_DEV_API_URL = originalDevUrl;
});

describe("normalising a server URL", () => {
  test.each([
    ["https://beacon.example.com", "https://beacon.example.com"],
    ["https://beacon.example.com/", "https://beacon.example.com"],
    ["https://beacon.example.com///", "https://beacon.example.com"],
    ["  HTTPS://Beacon.Example.com:443/ ", "https://beacon.example.com"],
    ["http://192.168.1.10:3000/", "http://192.168.1.10:3000"],
    ["https://example.com/openbeacon", "https://example.com/openbeacon"],
    ["https://example.com/apps/openbeacon//", "https://example.com/apps/openbeacon"],
  ])("accepts %p as %p", (input, expected) => {
    expect(normaliseServerUrl(input)).toEqual({ url: expected, error: null });
  });

  test.each([
    ["", "Enter a URL that starts with http:// or https://"],
    ["beacon.example.com", "Enter a URL that starts with http:// or https://"],
    ["ftp://beacon.example.com", "Enter a URL that starts with http:// or https://"],
    ["javascript:alert(1)", "Enter a URL that starts with http:// or https://"],
    ["https://user:secret@beacon.example.com", "Remove the username and password from the URL"],
    ["https://beacon.example.com/?x=1", "Remove everything from the ? or # onwards"],
    ["https://beacon.example.com/?", "Remove everything from the ? or # onwards"],
    ["https://beacon.example.com/#top", "Remove everything from the ? or # onwards"],
  ])("rejects %p", (input, error) => {
    expect(normaliseServerUrl(input)).toEqual({ url: null, error });
  });
});

describe("the saved server", () => {
  test("is saved normalised", () => {
    setServerUrl("https://beacon.example.com/");
    expect(stored.get("custom_server_url")).toBe("https://beacon.example.com");
  });

  test("a value saved before normalising is normalised when read", () => {
    stored.set("custom_server_url", "https://beacon.example.com/");
    expect(getServerUrl()).toBe("https://beacon.example.com");
  });

  test("a saved value that can't be used falls back to the hosted server", () => {
    delete process.env.EXPO_PUBLIC_DEV_API_URL;
    stored.set("custom_server_url", "https://beacon.example.com/?x=1");
    expect(getServerUrl()).toBe("");
    expect(getBaseUrl()).toBe("https://api.openbeacon.net");
  });

  test("clearing it goes back to the hosted server", () => {
    delete process.env.EXPO_PUBLIC_DEV_API_URL;
    setServerUrl("https://beacon.example.com");
    setServerUrl("");
    expect(stored.has("custom_server_url")).toBe(false);
    expect(getBaseUrl()).toBe("https://api.openbeacon.net");
  });
});

describe("the base URL", () => {
  test("uses the hosted API by default", () => {
    delete process.env.EXPO_PUBLIC_DEV_API_URL;
    expect(getBaseUrl()).toBe("https://api.openbeacon.net");
  });

  test("uses a saved custom server", () => {
    delete process.env.EXPO_PUBLIC_DEV_API_URL;
    setServerUrl("https://self-hosted.example");
    expect(getBaseUrl()).toBe("https://self-hosted.example");
  });

  test("gives the development override precedence", () => {
    process.env.EXPO_PUBLIC_DEV_API_URL = "http://localhost:3000/";
    setServerUrl("https://self-hosted.example");
    expect(getBaseUrl()).toBe("http://localhost:3000");
  });

  test("always sends feedback to the hosted API, even with a custom server", () => {
    delete process.env.EXPO_PUBLIC_DEV_API_URL;
    setServerUrl("https://self-hosted.example");
    expect(getFeedbackUrl()).toBe("https://api.openbeacon.net");
  });
});
