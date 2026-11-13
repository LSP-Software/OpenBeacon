import { beforeEach, expect, mock, setSystemTime, test } from "bun:test";
import type { setLocationSharingSchema } from "@openbeacon/schemas";
import { resolveLocationSharing, type SharingPreference } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import type { z } from "zod";

type Change = z.infer<typeof setLocationSharingSchema>;
type ServerScope = SharingPreference & { requestId: string | null };

const stored = new Map<string, string>();
const nativeStates: {
  owner: string;
  prefix: string;
  paused: boolean;
  pausedUntil: number | null;
  resumeAfter: number | null;
}[] = [];
const changes: Change[] = [];
let offline = false;
let knownOffline = false;
let offlineCheckGate: Promise<void> | null = null;
let rejectWith: Error | null = null;
let loseReply = false;
let nextRequestId = 0;
let nativeAccepted = true;
let registeredDeviceId = "phone";
let serverClockAhead = 0;
let beforeMutation: (() => Promise<void>) | null = null;
let onNativePause = () => {};
let server: { account: ServerScope; device: ServerScope };
let query: () => Promise<ReturnType<typeof sharingState>>;
const scope = (): ServerScope => ({
  sharingPaused: false,
  sharingPausedUntil: null,
  sharingChangedAt: null,
  sharingRevision: 0,
  requestId: null,
});
const serverTime = () => Date.now() + serverClockAhead;
const sharingState = () => ({
  account: server.account,
  device: server.device,
  deviceId: registeredDeviceId,
  userId: "alex",
  serverTime: new Date(serverTime()),
  ...resolveLocationSharing(server.account, server.device, serverTime()),
});
const applyChange = (change: Change) => {
  const current = server[change.scope];
  if (current.requestId === change.requestId) return "applied";
  const matchesBase =
    change.expectedRevision === null
      ? change.paused &&
        (current.sharingChangedAt === null ||
          current.sharingChangedAt.getTime() <= change.requestedAt.getTime() + 5_000)
      : change.expectedRevision === current.sharingRevision;
  if (!matchesBase && change.replacesRequestId !== current.requestId) return "superseded";
  const expired = change.pausedUntil !== null && change.pausedUntil.getTime() <= serverTime();
  server[change.scope] = {
    sharingPaused: change.paused && !expired,
    sharingPausedUntil: expired ? null : change.pausedUntil,
    sharingChangedAt: new Date(serverTime()),
    sharingRevision: current.sharingRevision + 1,
    requestId: change.requestId,
  };
  return expired ? "expired" : "applied";
};
const changeFromAnotherPhone = (scopeName: "device" | "account", paused: boolean) => {
  server[scopeName] = {
    ...server[scopeName],
    sharingPaused: paused,
    sharingPausedUntil: null,
    sharingChangedAt: new Date(serverTime()),
    sharingRevision: server[scopeName].sharingRevision + 1,
    requestId: "other-phone",
  };
};
mock.module("react-native", () => ({ Platform: { OS: "android" } }));
mock.module("./currentServer.ts", () => ({ baseUrl: "https://server.test" }));
mock.module("./createSecureId.ts", () => ({ createSecureId: () => `request-${++nextRequestId}` }));
mock.module("./deviceKeys.ts", () => ({
  getStoredDeviceId: () => registeredDeviceId,
  getRegisteredDeviceKey: async () => ({ userId: "alex", deviceId: registeredDeviceId }),
}));
mock.module("./networkStatus.ts", () => ({
  isDeviceOffline: async () => {
    const gate = offlineCheckGate;
    offlineCheckGate = null;
    await gate;
    return knownOffline;
  },
}));
mock.module("./trackingEvents.ts", () => ({ requestTrackingSync: () => {} }));
mock.module("./storage.ts", () => ({
  storage: {
    getAllKeys: () => [...stored.keys()],
    getString: (key: string) => stored.get(key),
    set: (key: string, value: string) => stored.set(key, value),
    remove: (key: string) => stored.delete(key),
  },
}));
mock.module("../modules/openbeacon-tracking/index.ts", () => ({
  default: {
    setSharingState: (
      owner: string,
      _deviceId: string,
      prefix: string,
      paused: boolean,
      pausedUntil: number | null,
      resumeAfter: number | null,
    ) => {
      if (!nativeAccepted) return false;
      nativeStates.push({ owner, prefix, paused, pausedUntil, resumeAfter });
      if (paused) onNativePause();
      return true;
    },
  },
}));
mock.module("./api.ts", () => ({
  trpcClient: {
    account: {
      locationSharing: { query: () => query() },
      setLocationSharing: {
        mutate: async (input: Change) => {
          if (offline) throw new Error("Offline");
          if (rejectWith) throw rejectWith;
          if (beforeMutation) await beforeMutation();
          changes.push(input);
          const status = applyChange(input);
          if (loseReply) throw new Error("Reply lost");
          return { status };
        },
      },
    },
  },
}));
const {
  abandonLocationSharingChanges,
  changeLocationSharing,
  clearPendingSharingChanges,
  hasPendingSharingPause,
  hasLocallyPausedSharing,
  hasRejectedSharingChange,
  getPendingSharingChanges,
  serverNow,
  syncLocationSharing,
} = await import("./locationSharing.ts");

beforeEach(() => {
  setSystemTime();
  stored.clear();
  nextRequestId = 0;
  nativeStates.length = 0;
  changes.length = 0;
  offline = false;
  knownOffline = false;
  offlineCheckGate = null;
  rejectWith = null;
  loseReply = false;
  nativeAccepted = true;
  registeredDeviceId = "phone";
  serverClockAhead = 0;
  beforeMutation = null;
  onNativePause = () => {};
  server = { account: scope(), device: scope() };
  query = async () => sharingState();
});

test("stops locally while offline and retries the pause before applying server state", async () => {
  offline = true;
  expect(
    await changeLocationSharing({
      scope: "device",
      paused: true,
      durationMinutes: null,
    }),
  ).toBe("queued");
  expect(nativeStates.at(-1)?.paused).toBe(true);
  expect(hasPendingSharingPause("alex")).toBe(true);
  offline = false;
  await syncLocationSharing();
  expect(changes).toHaveLength(1);
  expect(hasPendingSharingPause("alex")).toBe(false);
  expect(nativeStates.at(-1)).toMatchObject({
    owner: JSON.stringify(["https://server.test", "alex"]),
    prefix: "s0.1:",
    paused: true,
  });
});

test("a known offline pause stops capture without trying the network", async () => {
  knownOffline = true;
  offline = true;
  const attempts = changes.length;
  expect(await changeLocationSharing({ scope: "account", paused: true, durationMinutes: 60 })).toBe(
    "queued",
  );
  expect(changes).toHaveLength(attempts);
  expect(nativeStates.at(-1)?.paused).toBe(true);
  expect(hasLocallyPausedSharing("alex")).toBe(true);
  expect(getPendingSharingChanges("alex").account?.paused).toBe(true);
  knownOffline = false;
  offline = false;
  await syncLocationSharing();
  expect(changes.map((change) => change.scope)).toEqual(["account"]);
  expect(server.account.sharingPaused).toBe(true);
  expect(hasPendingSharingPause("alex")).toBe(false);
});

test("an older offline change that finishes its checks late doesn't replace a newer one", async () => {
  knownOffline = true;
  offline = true;
  let releaseOlder = () => {};
  offlineCheckGate = new Promise((resolve) => {
    releaseOlder = resolve;
  });
  const older = changeLocationSharing({ scope: "device", paused: false, durationMinutes: null });
  for (let index = 0; index < 20; index++) await Promise.resolve();
  expect(
    await changeLocationSharing({ scope: "device", paused: true, durationMinutes: null }),
  ).toBe("queued");

  releaseOlder();

  await expect(older).rejects.toThrow("A newer sharing change replaced this one.");
  expect(getPendingSharingChanges("alex").device?.paused).toBe(true);
  expect(nativeStates.at(-1)?.paused).toBe(true);
});

test("signing out during the connectivity check stops the change writing anything", async () => {
  knownOffline = true;
  offline = true;
  let release = () => {};
  offlineCheckGate = new Promise((resolve) => {
    release = resolve;
  });
  const change = changeLocationSharing({ scope: "device", paused: true, durationMinutes: null });
  for (let index = 0; index < 20; index++) await Promise.resolve();

  abandonLocationSharingChanges();
  clearPendingSharingChanges("alex");
  release();

  await expect(change).rejects.toThrow("You've signed out.");
  expect(hasPendingSharingPause("alex")).toBe(false);
  expect(nativeStates).toHaveLength(0);
});

test("a known offline resume of this phone applies locally and queues", async () => {
  server.device = { ...scope(), sharingPaused: true, sharingRevision: 1, requestId: "earlier" };
  await syncLocationSharing();
  expect(nativeStates.at(-1)?.paused).toBe(true);
  knownOffline = true;
  offline = true;
  expect(
    await changeLocationSharing({ scope: "device", paused: false, durationMinutes: null }),
  ).toBe("queued");
  expect(nativeStates.at(-1)?.paused).toBe(false);
  expect(getPendingSharingChanges("alex").device?.paused).toBe(false);
});

test("pausing another device while known offline fails at once and stores nothing", async () => {
  knownOffline = true;
  await expect(
    changeLocationSharing({
      scope: "device",
      deviceId: "tablet",
      paused: true,
      durationMinutes: 60,
    }),
  ).rejects.toThrow("Can’t reach the server");
  expect(changes).toHaveLength(0);
  expect(nativeStates).toHaveLength(0);
  expect(hasPendingSharingPause("alex")).toBe(false);
});

test("keeps both device and account pauses pending across a network failure", async () => {
  offline = true;
  await changeLocationSharing({
    scope: "device",
    paused: true,
    durationMinutes: null,
  });
  await changeLocationSharing({
    scope: "account",
    paused: true,
    durationMinutes: 60,
  });
  offline = false;
  await syncLocationSharing();
  expect(changes.map((change) => change.scope)).toEqual(["device", "account"]);
  expect(hasPendingSharingPause("alex")).toBe(false);
});

test("a pause whose reply was lost is retried with the same request and doesn't restart", async () => {
  loseReply = true;
  expect(
    await changeLocationSharing({
      scope: "device",
      paused: true,
      durationMinutes: 15,
    }),
  ).toBe("queued");
  const firstDeadline = server.device.sharingPausedUntil;
  loseReply = false;
  await syncLocationSharing();
  expect(changes.map((change) => change.requestId)).toEqual(["request-1", "request-1"]);
  expect(server.device.sharingRevision).toBe(1);
  expect(server.device.sharingPausedUntil).toEqual(firstDeadline);
});

test("a queued pause is dropped when another phone changed this device since", async () => {
  await syncLocationSharing();
  changeFromAnotherPhone("device", true);
  await syncLocationSharing();
  offline = true;
  await changeLocationSharing({
    scope: "device",
    paused: true,
    durationMinutes: null,
    expectedRevision: 1,
  });
  changeFromAnotherPhone("device", false);
  offline = false;
  await syncLocationSharing();
  expect(changes.at(-1)?.expectedRevision).toBe(1);
  expect(server.device.sharingPaused).toBe(false);
  expect(server.device.sharingRevision).toBe(2);
  expect(hasPendingSharingPause("alex")).toBe(false);
  expect(nativeStates.at(-1)).toMatchObject({ paused: false, prefix: "s0.2:" });
});

test("a fresh change reports when another phone got there first", async () => {
  changeFromAnotherPhone("device", true);
  expect(
    await changeLocationSharing({
      scope: "device",
      paused: false,
      durationMinutes: null,
      expectedRevision: 0,
    }),
  ).toBe("superseded");
  expect(server.device.sharingPaused).toBe(true);
  expect(hasPendingSharingPause("alex")).toBe(false);
});

test("a pause tapped online applies even if another phone changed sharing since it loaded", async () => {
  changeFromAnotherPhone("device", true);
  changeFromAnotherPhone("device", false);
  expect(
    await changeLocationSharing({
      scope: "device",
      paused: true,
      durationMinutes: null,
      expectedRevision: 0,
    }),
  ).toBe("applied");
  expect(server.device.sharingPaused).toBe(true);
});

test("resuming offline replaces the queued pause and resumes capture on this phone", async () => {
  await syncLocationSharing();
  offline = true;
  await changeLocationSharing({
    scope: "device",
    paused: true,
    durationMinutes: null,
  });
  expect(
    await changeLocationSharing({
      scope: "device",
      paused: false,
      durationMinutes: null,
    }),
  ).toBe("queued");
  expect(getPendingSharingChanges("alex").device).toMatchObject({
    paused: false,
    expectedRevision: 0,
    replacesRequestId: "request-1",
  });
  expect(nativeStates.at(-1)?.paused).toBe(false);
  expect(hasLocallyPausedSharing("alex")).toBe(false);
  offline = false;
  await syncLocationSharing();
  expect(changes.map((change) => change.paused)).toEqual([false]);
  expect(server.device.sharingPaused).toBe(false);
  expect(nativeStates.at(-1)?.paused).toBe(false);
});

test("an offline resume the native runtime rejected fails and keeps the queued pause", async () => {
  await syncLocationSharing();
  offline = true;
  await changeLocationSharing({
    scope: "device",
    paused: true,
    durationMinutes: null,
  });
  nativeAccepted = false;
  await expect(
    changeLocationSharing({
      scope: "device",
      paused: false,
      durationMinutes: null,
    }),
  ).rejects.toThrow();
  expect(getPendingSharingChanges("alex").device).toMatchObject({
    paused: true,
    requestId: "request-1",
  });
  expect(hasLocallyPausedSharing("alex")).toBe(true);
});

test("an offline resume of a confirmed pause the native runtime rejected is not queued", async () => {
  changeFromAnotherPhone("device", true);
  await syncLocationSharing();
  offline = true;
  nativeAccepted = false;
  await expect(
    changeLocationSharing({
      scope: "device",
      paused: false,
      durationMinutes: null,
    }),
  ).rejects.toThrow();
  expect(hasPendingSharingPause("alex")).toBe(false);
  expect(hasLocallyPausedSharing("alex")).toBe(true);
});

test("a resume still wins when the queued pause reached the server but its reply was lost", async () => {
  await syncLocationSharing();
  loseReply = true;
  await changeLocationSharing({
    scope: "device",
    paused: true,
    durationMinutes: null,
  });
  loseReply = false;
  offline = true;
  await changeLocationSharing({
    scope: "device",
    paused: false,
    durationMinutes: null,
  });
  offline = false;
  await syncLocationSharing();
  expect(server.device.sharingPaused).toBe(false);
  expect(server.device.sharingRevision).toBe(2);
  expect(hasPendingSharingPause("alex")).toBe(false);
});

test("an offline resume keeps capture stopped while the account is still paused", async () => {
  changeFromAnotherPhone("account", true);
  changeFromAnotherPhone("device", true);
  await syncLocationSharing();
  offline = true;
  expect(
    await changeLocationSharing({
      scope: "device",
      paused: false,
      durationMinutes: null,
    }),
  ).toBe("queued");
  expect(nativeStates.at(-1)?.paused).toBe(true);
  expect(hasLocallyPausedSharing("alex")).toBe(true);
});

test("an offline timed pause ends at the tapped time on the phone and on the server", async () => {
  serverClockAhead = 10 * 60_000;
  await syncLocationSharing();
  offline = true;
  const tappedAt = Date.now();
  await changeLocationSharing({
    scope: "device",
    paused: true,
    durationMinutes: 15,
  });
  const nativeDeadline = nativeStates.at(-1)?.pausedUntil ?? 0;
  expect(nativeDeadline - tappedAt).toBeWithin(15 * 60_000 - 50, 15 * 60_000 + 50);
  const queued = getPendingSharingChanges("alex").device?.pausedUntil?.getTime() ?? 0;
  expect(queued - nativeDeadline).toBeWithin(serverClockAhead - 50, serverClockAhead + 50);
});

test("a timed device pause made offline doesn't end an indefinite account pause early", async () => {
  changeFromAnotherPhone("account", true);
  await syncLocationSharing();
  offline = true;
  await changeLocationSharing({
    scope: "device",
    paused: true,
    durationMinutes: 15,
  });
  expect(nativeStates.at(-1)).toMatchObject({
    paused: true,
    pausedUntil: null,
  });
});

test("converts server deadlines to the phone's clock before handing them to capture", async () => {
  serverClockAhead = -30 * 60_000;
  const deadline = new Date(serverTime() + 60 * 60_000);
  server.device = {
    ...server.device,
    sharingPaused: true,
    sharingPausedUntil: deadline,
    sharingChangedAt: new Date(serverTime()),
    sharingRevision: 1,
  };
  await syncLocationSharing();
  expect(serverNow() - Date.now()).toBeWithin(serverClockAhead - 50, serverClockAhead + 50);
  expect(
    (nativeStates.at(-1)?.pausedUntil ?? 0) - (deadline.getTime() - serverClockAhead),
  ).toBeWithin(-50, 50);
});

test("a phone clock days behind the server can still pause and resume", async () => {
  serverClockAhead = 3 * 24 * 60 * 60_000;
  await syncLocationSharing();
  expect(
    await changeLocationSharing({ scope: "device", paused: true, durationMinutes: null }),
  ).not.toBe("queued");
  expect(changes.at(-1)?.paused).toBe(true);
  await changeLocationSharing({ scope: "device", paused: false, durationMinutes: null });
  expect(changes.at(-1)?.paused).toBe(false);
});

test("signing out forgets queued changes so they aren't replayed later", async () => {
  offline = true;
  await changeLocationSharing({
    scope: "account",
    paused: true,
    durationMinutes: null,
  });
  await changeLocationSharing({
    scope: "device",
    paused: true,
    durationMinutes: null,
  });
  clearPendingSharingChanges();
  offline = false;
  await syncLocationSharing();
  expect(changes).toEqual([]);
  expect(hasPendingSharingPause("alex")).toBe(false);
});

test("a response requested before a pause cannot resume capture afterwards", async () => {
  let release = () => {};
  let started = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const old = sharingState();
  let calls = 0;
  query = async () => {
    calls += 1;
    if (calls === 1) {
      started();
      await gate;
      return old;
    }
    return sharingState();
  };
  const stale = syncLocationSharing();
  await entered;
  let locallyStopped = () => {};
  const stopped = new Promise<void>((resolve) => {
    locallyStopped = resolve;
  });
  onNativePause = locallyStopped;
  const change = changeLocationSharing({
    scope: "device",
    paused: true,
    durationMinutes: null,
  });
  await stopped;
  expect(changes).toHaveLength(0);
  release();
  await Promise.all([stale, change]);
  expect(nativeStates.at(-1)?.paused).toBe(true);
});

test("serializes a pending account retry before a newer resume", async () => {
  offline = true;
  await changeLocationSharing({
    scope: "account",
    paused: true,
    durationMinutes: null,
  });
  offline = false;
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  beforeMutation = async () => {
    entered();
    await gate;
  };
  const retry = syncLocationSharing();
  await started;
  const resume = changeLocationSharing({
    scope: "account",
    paused: false,
    durationMinutes: null,
  });
  release();
  await Promise.all([retry, resume]);
  expect(changes.map((change) => change.paused)).toEqual([true, false]);
  expect(server.account.sharingPaused).toBe(false);
  expect(hasPendingSharingPause("alex")).toBe(false);
  expect(nativeStates.at(-1)?.paused).toBe(false);
  expect(hasLocallyPausedSharing("alex")).toBe(false);
});

test("concurrent syncs submit a pending change once", async () => {
  offline = true;
  await changeLocationSharing({
    scope: "device",
    paused: true,
    durationMinutes: 15,
  });
  offline = false;
  await Promise.all([syncLocationSharing(), syncLocationSharing()]);
  expect(changes).toHaveLength(1);
});

test("binds device changes to the original account and explicit device", async () => {
  await changeLocationSharing({
    scope: "device",
    paused: true,
    durationMinutes: null,
  });
  expect(changes[0]).toMatchObject({
    expectedUserId: "alex",
    deviceId: "phone",
    scope: "device",
  });
});

test("does not claim a local stop when the native runtime rejected it", async () => {
  nativeAccepted = false;
  offline = true;
  await expect(
    changeLocationSharing({
      scope: "account",
      paused: true,
      durationMinutes: null,
    }),
  ).rejects.toThrow();
  expect(hasPendingSharingPause("alex")).toBe(true);
  expect(hasLocallyPausedSharing("alex")).toBe(false);
  expect(getPendingSharingChanges("alex").account?.scope).toBe("account");
});

test("a failed refresh does not turn a saved change into a failed mutation", async () => {
  query = async () => {
    throw new Error("Refresh failed");
  };
  expect(
    await changeLocationSharing({
      scope: "device",
      paused: true,
      durationMinutes: null,
    }),
  ).toBe("applied");
  expect(changes).toHaveLength(1);
  expect(hasPendingSharingPause("alex")).toBe(false);
  expect(hasLocallyPausedSharing("alex")).toBe(true);
});

test("a replacement device does not replay the old device's local pause", async () => {
  offline = true;
  await changeLocationSharing({
    scope: "device",
    paused: true,
    durationMinutes: null,
  });
  expect(hasLocallyPausedSharing("alex")).toBe(true);
  registeredDeviceId = "replacement";
  offline = false;
  await syncLocationSharing();
  expect(changes).toEqual([]);
  expect(hasLocallyPausedSharing("alex")).toBe(false);
  expect(hasPendingSharingPause("alex")).toBe(false);
});

test("forgets a queued change saved in a format it no longer understands", async () => {
  stored.set(
    `locationSharing.pending.${JSON.stringify(["https://server.test", "alex", "device"])}`,
    JSON.stringify({
      requestId: "old",
      input: { scope: "device", paused: true },
    }),
  );
  await syncLocationSharing();
  expect(changes).toEqual([]);
  expect(hasPendingSharingPause("alex")).toBe(false);
});

test("a sync still running at sign-out neither stores nor applies its late response", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = () => {};
  const queried = new Promise<void>((resolve) => {
    started = resolve;
  });
  changeFromAnotherPhone("device", true);
  query = async () => {
    started();
    await gate;
    return sharingState();
  };
  const sync = syncLocationSharing();
  await queried;
  abandonLocationSharingChanges();
  clearPendingSharingChanges();
  const storedAtSignOut = new Map(stored);
  release();
  await sync;
  expect(stored).toEqual(storedAtSignOut);
  expect(nativeStates).toEqual([]);
});

test("a change answered after sign-out doesn't refresh or touch capture", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = () => {};
  const sent = new Promise<void>((resolve) => {
    entered = resolve;
  });
  changeFromAnotherPhone("device", true);
  await syncLocationSharing();
  nativeStates.length = 0;
  beforeMutation = () => {
    entered();
    return gate;
  };
  const change = changeLocationSharing({
    scope: "device",
    paused: false,
    durationMinutes: null,
  });
  await sent;
  abandonLocationSharingChanges();
  clearPendingSharingChanges();
  let queries = 0;
  query = async () => {
    queries += 1;
    return sharingState();
  };
  release();
  expect(await change).toBe("applied");
  expect(queries).toBe(0);
  expect(nativeStates).toEqual([]);
  expect(hasPendingSharingPause("alex")).toBe(false);
});

test("a replayed pause whose reply was lost cannot undo a resume made on another phone", async () => {
  await syncLocationSharing();
  loseReply = true;
  expect(
    await changeLocationSharing({
      scope: "device",
      paused: true,
      durationMinutes: null,
    }),
  ).toBe("queued");
  loseReply = false;
  expect(changes.at(-1)?.expectedRevision).toBeNull();
  changeFromAnotherPhone("device", false);
  await syncLocationSharing();
  expect(changes.at(-1)).toMatchObject({ requestId: "request-1", expectedRevision: 0 });
  expect(server.device).toMatchObject({ sharingPaused: false, sharingRevision: 2 });
  expect(hasPendingSharingPause("alex")).toBe(false);
  expect(nativeStates.at(-1)).toMatchObject({ paused: false, prefix: "s0.2:" });
});

test("a pause tapped before sharing loaded is replayed with its tap time and can't undo a later resume", async () => {
  loseReply = true;
  expect(
    await changeLocationSharing({
      scope: "device",
      paused: true,
      durationMinutes: null,
    }),
  ).toBe("queued");
  loseReply = false;
  const tappedAt = changes[0]?.requestedAt ?? new Date(0);
  expect(getPendingSharingChanges("alex").device).toMatchObject({
    expectedRevision: null,
    requestedAt: tappedAt,
  });
  setSystemTime(new Date(Date.now() + 60_000));
  changeFromAnotherPhone("device", false);
  await syncLocationSharing();
  expect(changes.map((change) => change.requestedAt)).toEqual([tappedAt, tappedAt]);
  expect(changes.at(-1)).toMatchObject({ requestId: "request-1", expectedRevision: null });
  expect(server.device).toMatchObject({ sharingPaused: false, sharingRevision: 2 });
  expect(hasPendingSharingPause("alex")).toBe(false);
  expect(nativeStates.at(-1)).toMatchObject({ paused: false, prefix: "s0.2:" });
});

const refusal = (code: string, reason: string | null = null) =>
  TRPCClientError.from({
    error: { code: -32600, data: { code, httpStatus: 400, reason }, message: code },
  });

for (const [name, error] of [
  ["a bad request", () => refusal("BAD_REQUEST")],
  ["a device the server doesn't have", () => refusal("NOT_FOUND")],
  ["a change for another account", () => refusal("FORBIDDEN")],
] as const) {
  test(`a queued pause refused as ${name} is dropped, the real state loaded and uploads resume`, async () => {
    serverClockAhead = 5 * 60_000;
    offline = true;
    await changeLocationSharing({ scope: "device", paused: true, durationMinutes: null });
    expect(hasPendingSharingPause("alex")).toBe(true);
    offline = false;
    rejectWith = error();

    await syncLocationSharing();

    expect(hasPendingSharingPause("alex")).toBe(false);
    expect(hasRejectedSharingChange("alex")).toBe(true);
    expect(nativeStates.at(-1)).toMatchObject({ paused: false });
    expect(Math.abs(serverNow() - serverTime())).toBeLessThan(1_000);
    expect(getPendingSharingChanges("alex")).toEqual({ device: null, account: null });
  });
}

test("a pause the server refuses straight away is undone and reported as rejected", async () => {
  rejectWith = refusal("BAD_REQUEST");

  expect(
    await changeLocationSharing({ scope: "device", paused: true, durationMinutes: null }),
  ).toBe("rejected");

  expect(hasPendingSharingPause("alex")).toBe(false);
  expect(hasRejectedSharingChange("alex")).toBe(true);
  expect(nativeStates.at(-1)).toMatchObject({ paused: false });

  rejectWith = null;
  await changeLocationSharing({ scope: "device", paused: true, durationMinutes: null });
  expect(hasRejectedSharingChange("alex")).toBe(false);
});

for (const [name, error] of [
  ["a network failure", () => new Error("Offline")],
  ["a server error", () => refusal("INTERNAL_SERVER_ERROR")],
  ["a rate limit", () => refusal("TOO_MANY_REQUESTS")],
  ["a phone that isn't set up yet", () => refusal("FORBIDDEN", "DEVICE_PENDING")],
] as const) {
  test(`a queued pause that fails with ${name} is kept while the state is still checked`, async () => {
    serverClockAhead = 5 * 60_000;
    offline = true;
    await changeLocationSharing({ scope: "device", paused: true, durationMinutes: null });
    offline = false;
    rejectWith = error();

    await expect(syncLocationSharing()).rejects.toBe(rejectWith);

    expect(hasPendingSharingPause("alex")).toBe(true);
    expect(hasRejectedSharingChange("alex")).toBe(false);
    expect(Math.abs(serverNow() - serverTime())).toBeLessThan(1_000);
    expect(nativeStates.at(-1)).toMatchObject({ paused: true });
  });
}

test("signing out forgets a rejected change", async () => {
  rejectWith = refusal("BAD_REQUEST");
  await changeLocationSharing({ scope: "device", paused: true, durationMinutes: null });

  clearPendingSharingChanges("alex");

  expect(hasRejectedSharingChange("alex")).toBe(false);
});
