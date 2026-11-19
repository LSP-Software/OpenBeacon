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
mock.module("./deviceActivation.ts", () => ({
  readThisDeviceState: () => thisDeviceState,
}));
mock.module("expo-router", () => ({
  router: { replace: (target: unknown) => replacements.push(target) },
}));

const {
  clearInviteForSignIn,
  clearPendingJoinCodes,
  openAppAfterSetup,
  saveJoinLinkForAfterSetup,
  saveInviteForSignIn,
  savePendingJoinCode,
  takeInviteForSignIn,
  takePendingInvite,
} = await import("./pendingJoinCode.ts");
const { inviteLink } = await import("./inviteLink.ts");

const code = "0123456789ABCDEF0123456789ABCDEF";
const server = "https://beacon.example.com/openbeacon";
const invite = { code, server: null };

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

    expect(takePendingInvite("user-1")).toEqual(invite);
    expect(takePendingInvite("user-1")).toBeNull();
    expect(storageValues.size).toBe(0);
  });

  test("a code saved for one account isn't handed to another, and is forgotten", () => {
    savePendingJoinCode({ code, userId: "user-1" });

    expect(takePendingInvite("user-2")).toBeNull();
    expect(takePendingInvite("user-1")).toBeNull();
  });

  test("saving a code for another account forgets the first account's code", () => {
    savePendingJoinCode({ code, userId: "user-1" });
    savePendingJoinCode({ code: "F".repeat(32), userId: "user-2" });

    expect([...storageValues.keys()]).toEqual(["pendingJoinCode.user-2"]);
  });

  test("a code expires after 24 hours", () => {
    savePendingJoinCode({ code, userId: "user-1" });
    now += 24 * 60 * 60 * 1000 - 1;
    expect(takePendingInvite("user-1")).toEqual(invite);

    savePendingJoinCode({ code, userId: "user-1" });
    now += 24 * 60 * 60 * 1000;
    expect(takePendingInvite("user-1")).toBeNull();
    expect(storageValues.size).toBe(0);
  });

  test("a code saved in the future or stored badly is ignored", () => {
    savePendingJoinCode({ code, userId: "user-1" });
    now -= 1;
    expect(takePendingInvite("user-1")).toBeNull();

    storageValues.set("pendingJoinCode.user-1", "garbage");
    expect(takePendingInvite("user-1")).toBeNull();

    storageValues.set("pendingJoinCode.user-1", JSON.stringify({ savedAt: now, code: "ABC" }));
    expect(takePendingInvite("user-1")).toBeNull();
  });

  test("a saved invite keeps the server it came from", () => {
    savePendingJoinCode({ code, server, userId: "user-1" });

    expect(takePendingInvite("user-1")).toEqual({ code, server });
  });

  test("clearing forgets every saved code and nothing else", () => {
    storageValues.set("other", "kept");
    savePendingJoinCode({ code, userId: "user-1" });
    storageValues.set("pendingJoinCode.user-2", "{}");

    clearPendingJoinCodes();

    expect([...storageValues.keys()]).toEqual(["other"]);
  });
});

describe("invite links opened during setup", () => {
  test("an invite link opened on a phone that isn't set up is saved for after setup", () => {
    expect(saveJoinLinkForAfterSetup(`openbeacon://join?code=${code}`)).toBe(true);

    expect(takePendingInvite("user-1")).toEqual(invite);
  });

  test("an invite link from another server opened during setup keeps its server", () => {
    expect(saveJoinLinkForAfterSetup(inviteLink({ code, server }))).toBe(true);

    expect(takePendingInvite("user-1")).toEqual({ code, server });
  });

  test("an invite link opened during onboarding is saved for after onboarding", () => {
    thisDeviceState = "active";
    storageValues.set("onboarding.user-1", "{}");

    expect(saveJoinLinkForAfterSetup(`openbeacon://join?code=${code}`)).toBe(true);

    expect(takePendingInvite("user-1")).toEqual(invite);
  });

  test("another account's unfinished onboarding doesn't hold back an invite", () => {
    thisDeviceState = "active";
    storageValues.set("onboarding.user-2", "{}");

    expect(saveJoinLinkForAfterSetup(`openbeacon://join?code=${code}`)).toBe(false);

    expect(takePendingInvite("user-1")).toBeNull();
  });

  test("an invite link on a set-up or unregistered phone opens normally and isn't saved", () => {
    thisDeviceState = "active";
    expect(saveJoinLinkForAfterSetup(`openbeacon://join?code=${code}`)).toBe(false);
    thisDeviceState = "unregistered";
    registeredUserId = null;
    expect(saveJoinLinkForAfterSetup(`openbeacon://join?code=${code}`)).toBe(false);

    expect(storageValues.size).toBe(0);
  });

  test("an invite whose server can't be used opens normally so the join screen can say why", () => {
    const link = `openbeacon://join?code=${code}&server=${encodeURIComponent("https://\u0430pi.openbeacon.net")}`;
    expect(saveJoinLinkForAfterSetup(link)).toBe(false);

    expect(storageValues.size).toBe(0);
  });

  test("a link that isn't an invite isn't saved", () => {
    expect(saveJoinLinkForAfterSetup("openbeacon://place?id=1")).toBe(false);

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

  test("passes a saved invite's server on to the join screen", () => {
    savePendingJoinCode({ code, server, userId: "user-1" });

    openAppAfterSetup("/");

    expect(replacements).toEqual([{ pathname: "/join", params: { code, server } }]);
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

describe("an invite kept for signing in on a new server", () => {
  test("is handed back once, then forgotten", () => {
    saveInviteForSignIn(code);

    expect(takeInviteForSignIn()).toBe(code);
    expect(takeInviteForSignIn()).toBeNull();
    expect(storageValues.size).toBe(0);
  });

  test("is still there just before 30 minutes and gone at 30 minutes", () => {
    saveInviteForSignIn(code);
    now += 30 * 60 * 1000 - 1;
    expect(takeInviteForSignIn()).toBe(code);

    saveInviteForSignIn(code);
    now += 30 * 60 * 1000;
    expect(takeInviteForSignIn()).toBeNull();
    expect(storageValues.size).toBe(0);
  });

  test("saved in the future is ignored", () => {
    saveInviteForSignIn(code);
    now -= 1;

    expect(takeInviteForSignIn()).toBeNull();
  });

  test.each([
    ["not JSON", "not json"],
    ["a bad code", JSON.stringify({ savedAt: now, code: "not-a-code" })],
    ["no time", JSON.stringify({ code })],
  ])("with %s is ignored and forgotten", (_, value) => {
    storageValues.set("inviteForSignIn", value);

    expect(takeInviteForSignIn()).toBeNull();
    expect(storageValues.size).toBe(0);
  });

  test("can be forgotten without being used", () => {
    saveInviteForSignIn(code);
    clearInviteForSignIn();

    expect(takeInviteForSignIn()).toBeNull();
  });

  test("survives clearing the join codes saved during setup", () => {
    savePendingJoinCode({ code: "F".repeat(32), userId: "user-1" });
    saveInviteForSignIn(code);
    clearPendingJoinCodes();

    expect(takeInviteForSignIn()).toBe(code);
  });
});
