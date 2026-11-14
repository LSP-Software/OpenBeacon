import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const storageValues = new Map<string, string>();
const replacements: unknown[] = [];
let registeredUserId: string | null = "user-1";
let thisDeviceState: "unregistered" | "registered" | "active" = "registered";
let now = Date.parse("2026-11-11T12:00:00.000Z");
const realDateNow = Date.now;

mock.module("./storage.ts", () => ({
  storage: {
    getAllKeys: () => [...storageValues.keys()],
    getString: (key: string) => storageValues.get(key),
    remove: (key: string) => storageValues.delete(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));
mock.module("./registeredDevice.ts", () => ({
  readRegisteredDeviceNow: () =>
    registeredUserId ? { deviceId: "device-1", publicKey: "key", userId: registeredUserId } : null,
}));
mock.module("./deviceActivation.ts", () => ({ readThisDeviceState: () => thisDeviceState }));
mock.module("expo-router", () => ({
  router: { replace: (target: unknown) => replacements.push(target) },
}));

const {
  clearPendingJoinCodes,
  joinCodeFromInput,
  joinCodeFromLink,
  openAppAfterSetup,
  saveJoinLinkForAfterSetup,
  savePendingJoinCode,
  takePendingJoinCode,
} = await import("./pendingJoinCode.ts");

const code = "0123456789ABCDEF0123456789ABCDEF";

beforeEach(() => {
  storageValues.clear();
  replacements.length = 0;
  registeredUserId = "user-1";
  thisDeviceState = "registered";
  now = Date.parse("2026-11-11T12:00:00.000Z");
  Date.now = () => now;
});

afterEach(() => {
  Date.now = realDateNow;
});

describe("saved join codes", () => {
  test("a saved code is handed back once, then forgotten", () => {
    savePendingJoinCode({ code, userId: "user-1" });

    expect(takePendingJoinCode("user-1")).toBe(code);
    expect(takePendingJoinCode("user-1")).toBeNull();
    expect(storageValues.size).toBe(0);
  });

  test("a code saved for one account isn't handed to another, and is forgotten", () => {
    savePendingJoinCode({ code, userId: "user-1" });

    expect(takePendingJoinCode("user-2")).toBeNull();
    expect(takePendingJoinCode("user-1")).toBeNull();
  });

  test("saving a code for another account forgets the first account's code", () => {
    savePendingJoinCode({ code, userId: "user-1" });
    savePendingJoinCode({ code: "F".repeat(32), userId: "user-2" });

    expect([...storageValues.keys()]).toEqual(["pendingJoinCode.user-2"]);
  });

  test("a code expires after 24 hours", () => {
    savePendingJoinCode({ code, userId: "user-1" });
    now += 24 * 60 * 60 * 1000 - 1;
    expect(takePendingJoinCode("user-1")).toBe(code);

    savePendingJoinCode({ code, userId: "user-1" });
    now += 24 * 60 * 60 * 1000;
    expect(takePendingJoinCode("user-1")).toBeNull();
    expect(storageValues.size).toBe(0);
  });

  test("a code saved in the future or stored badly is ignored", () => {
    savePendingJoinCode({ code, userId: "user-1" });
    now -= 1;
    expect(takePendingJoinCode("user-1")).toBeNull();

    storageValues.set("pendingJoinCode.user-1", "garbage");
    expect(takePendingJoinCode("user-1")).toBeNull();
  });

  test("clearing forgets every saved code and nothing else", () => {
    storageValues.set("other", "kept");
    savePendingJoinCode({ code, userId: "user-1" });
    storageValues.set("pendingJoinCode.user-2", `${now}:${code}`);

    clearPendingJoinCodes();

    expect([...storageValues.keys()]).toEqual(["other"]);
  });
});

describe("join links", () => {
  test.each([
    `openbeacon://join?code=${code}`,
    `openbeacon:///join?code=${code}`,
    `openbeacon://join/?code=${code.toLowerCase()}`,
    `/join?code=${code}`,
    `exp+open-beacon://expo-development-client/--/join?other=1&code=${code}#top`,
  ])("reads the code from %s", (link) => {
    expect(joinCodeFromLink(link)).toBe(code);
  });

  test.each([
    `openbeacon://setup?code=${code}`,
    `openbeacon://rejoin?code=${code}`,
    "openbeacon://join",
    "openbeacon://join?code=",
    "openbeacon://join?code=ABC123",
    `openbeacon://join?xcode=${code}`,
  ])("ignores %s", (link) => {
    expect(joinCodeFromLink(link)).toBeNull();
  });

  test.each([code, ` ${code.toLowerCase()} `, `openbeacon://join?code=${code}`])(
    "accepts a typed or scanned %s",
    (input) => {
      expect(joinCodeFromInput(input)).toBe(code);
    },
  );

  test.each(["", "ABC123", `${code}0`, "https://example.test/"])("rejects %s", (input) => {
    expect(joinCodeFromInput(input)).toBeNull();
  });

  test("an invite link opened on a phone that isn't set up is saved for after setup", () => {
    saveJoinLinkForAfterSetup(`openbeacon://join?code=${code}`);

    expect(takePendingJoinCode("user-1")).toBe(code);
  });

  test("an invite link on a set-up or unregistered phone opens normally and isn't saved", () => {
    thisDeviceState = "active";
    saveJoinLinkForAfterSetup(`openbeacon://join?code=${code}`);
    thisDeviceState = "unregistered";
    registeredUserId = null;
    saveJoinLinkForAfterSetup(`openbeacon://join?code=${code}`);

    expect(storageValues.size).toBe(0);
  });
});

describe("leaving setup", () => {
  test("opens the saved invite instead of the app, then forgets it", () => {
    savePendingJoinCode({ code, userId: "user-1" });

    openAppAfterSetup("/");
    openAppAfterSetup("/");

    expect(replacements).toEqual([{ pathname: "/join", params: { code } }, "/"]);
  });

  test("goes to the given screen when there's no saved invite", () => {
    openAppAfterSetup("/(tabs)/map");

    expect(replacements).toEqual(["/(tabs)/map"]);
  });

  test("ignores an expired invite", () => {
    savePendingJoinCode({ code, userId: "user-1" });
    now += 25 * 60 * 60 * 1000;

    openAppAfterSetup("/");

    expect(replacements).toEqual(["/"]);
  });

  test("forgets saved invites when this phone has no account", () => {
    savePendingJoinCode({ code, userId: "user-1" });
    registeredUserId = null;

    openAppAfterSetup("/");

    expect(replacements).toEqual(["/"]);
    expect(storageValues.size).toBe(0);
  });
});
