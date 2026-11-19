import { beforeEach, expect, mock, test } from "bun:test";
import type { AlertButton } from "react-native";
import { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const server = "https://beacon.example.com";
const alerts: {
  title: string;
  message: string | undefined;
  buttons: AlertButton[];
}[] = [];
const serverChanges: string[] = [];
const events: string[] = [];
const compatibility: {
  verdict: "ok" | "appTooOld" | "serverTooOld" | null;
  problem?: { kind: "notOpenBeacon" };
}[] = [];
let signedIn = false;

mock.module("expo-router", () => ({ router: { push: () => {} } }));
mock.module("../lib/alert.ts", () => ({
  Alert: {
    alert: (title: string, message?: string, buttons: AlertButton[] = []) =>
      alerts.push({ title, message, buttons }),
  },
}));
mock.module("../lib/storage.ts", () => ({
  storage: { getString: () => undefined },
}));
mock.module("../lib/changeServer.ts", () => ({
  changeServer: async (url: string) => {
    serverChanges.push(url);
    events.push("changeServer");
  },
}));
mock.module("../lib/apiCompatibility.ts", () => ({
  checkServerCompatibility: async () => ({
    problem: { kind: "unreachable" },
    serverVersion: "0.1.0",
    ...(compatibility.shift() ?? { verdict: "ok" }),
  }),
}));
mock.module("../lib/api.ts", () => ({
  trpc: { accountRecovery: { status: { queryOptions: () => ({}) } } },
}));
mock.module("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { recoveryKey: "set" } }),
}));
mock.module("../lib/endSession.ts", () => ({ readLostSessions: () => [] }));
mock.module("../lib/thisDeviceNoun.ts", () => ({
  thisDeviceNoun: () => "phone",
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: {
    useSession: () => ({ data: signedIn ? { user: { id: "user-1" } } : null }),
  },
}));

const { useServerChange } = await import("./useServerChange.ts");

const renderHook = async () => {
  let latest: ReturnType<typeof useServerChange> | null = null;
  const Harness = () => {
    latest = useServerChange();
    return null;
  };
  await act(async () => createRoot().render(<Harness />));
  if (!latest) throw new Error("Hook didn't render");
  return latest as ReturnType<typeof useServerChange>;
};

const pressAlertButton = async (label: string) => {
  const button = alerts.at(-1)?.buttons.find(({ text }) => text === label);
  if (!button?.onPress) throw new Error(`No ${label} in the alert`);
  await act(async () => button.onPress?.());
};

const startInviteChange = async (stillWanted = () => true) => {
  const { changeServerForInvite } = await renderHook();
  let outcome: boolean | null = null;
  const done = changeServerForInvite(server, stillWanted, () => events.push("beforeChange")).then(
    (changed) => {
      outcome = changed;
    },
  );
  await act(async () => {});
  return { done, outcome: () => outcome };
};

beforeEach(() => {
  alerts.length = 0;
  serverChanges.length = 0;
  events.length = 0;
  compatibility.length = 0;
  signedIn = false;
});

test("an invite address that isn't an OpenBeacon server can only be acknowledged", async () => {
  compatibility.push({ verdict: null, problem: { kind: "notOpenBeacon" } });
  const change = await startInviteChange();

  expect(alerts.map(({ title, buttons }) => [title, buttons.map((b) => b.text)])).toEqual([
    ["This isn’t an OpenBeacon server", ["OK"]],
  ]);
  await pressAlertButton("OK");
  await change.done;

  expect(change.outcome()).toBe(false);
  expect(serverChanges).toEqual([]);
});

test("an invite server the app is too old for can only be acknowledged", async () => {
  compatibility.push({ verdict: "appTooOld" });
  const change = await startInviteChange();

  expect(
    alerts.map(({ title, message, buttons }) => [title, message, buttons.map((b) => b.text)]),
  ).toEqual([
    [
      "Update the app first",
      "This server needs a newer version of OpenBeacon. Update the app, then open the invite again.",
      ["OK"],
    ],
  ]);
  await pressAlertButton("OK");
  await change.done;

  expect(change.outcome()).toBe(false);
  expect(serverChanges).toEqual([]);
  expect(events).toEqual([]);
});

test("an out-of-date invite server can still be changed to", async () => {
  compatibility.push({ verdict: "serverTooOld" });
  const change = await startInviteChange();

  expect(alerts[0]?.title).toBe("This server needs updating");
  expect(alerts[0]?.buttons.map(({ text }) => text)).toEqual(["Cancel", "Change anyway"]);
  await pressAlertButton("Change anyway");
  await change.done;

  expect(change.outcome()).toBe(true);
  expect(serverChanges).toEqual([server]);
  expect(events).toEqual(["beforeChange", "changeServer"]);
});

test("trying an unreachable invite server again changes once it answers", async () => {
  compatibility.push({ verdict: null }, { verdict: "ok" });
  const change = await startInviteChange();

  expect(alerts[0]?.message).toBe(
    "Check your connection. If it still doesn’t work, ask whoever sent the invite to check their server is running.",
  );
  await pressAlertButton("Try again");
  await change.done;

  expect(alerts).toHaveLength(1);
  expect(change.outcome()).toBe(true);
  expect(serverChanges).toEqual([server]);
});

test("cancelling the sign-out warning reports no change", async () => {
  signedIn = true;
  const change = await startInviteChange();

  expect(alerts.map(({ title }) => title)).toEqual(["Change server?"]);
  await pressAlertButton("Cancel");
  await change.done;

  expect(change.outcome()).toBe(false);
  expect(serverChanges).toEqual([]);
  expect(events).toEqual([]);
});

test("the server is checked before the sign-out warning, which comes before the change", async () => {
  signedIn = true;
  compatibility.push({ verdict: "serverTooOld" });
  const change = await startInviteChange();

  expect(alerts.map(({ title }) => title)).toEqual(["This server needs updating"]);
  await pressAlertButton("Change anyway");
  expect(alerts.map(({ title }) => title)).toEqual([
    "This server needs updating",
    "Change server?",
  ]);
  expect(events).toEqual([]);
  await pressAlertButton("Change server");
  await change.done;

  expect(change.outcome()).toBe(true);
  expect(events).toEqual(["beforeChange", "changeServer"]);
});

test("a failed server check never reaches the sign-out warning", async () => {
  signedIn = true;
  compatibility.push({ verdict: null });
  const change = await startInviteChange();

  await pressAlertButton("Cancel");
  await change.done;

  expect(alerts.map(({ title }) => title)).toEqual(["Couldn’t reach this server"]);
  expect(change.outcome()).toBe(false);
  expect(events).toEqual([]);
});

test("an invite dropped while the sign-out warning is open changes nothing", async () => {
  signedIn = true;
  let wanted = true;
  const change = await startInviteChange(() => wanted);

  wanted = false;
  await pressAlertButton("Change server");
  await change.done;

  expect(change.outcome()).toBe(false);
  expect(events).toEqual([]);
});

test("a check that finishes after the invite was dropped shows nothing", async () => {
  compatibility.push({ verdict: null });
  const change = await startInviteChange(() => false);
  await change.done;

  expect(alerts).toEqual([]);
  expect(change.outcome()).toBe(false);
  expect(serverChanges).toEqual([]);
});

test("the Custom server screen keeps its own wording and Save anyway", async () => {
  compatibility.push({ verdict: null });
  const { checkCompatibilityBeforeSave } = await renderHook();
  const saves: string[] = [];

  await act(async () =>
    checkCompatibilityBeforeSave(server, async () => {
      saves.push(server);
    }),
  );

  expect(
    alerts.map(({ title, message, buttons }) => [title, message, buttons.map((b) => b.text)]),
  ).toEqual([
    [
      "Couldn’t reach this server",
      "Check the address, that the server is running and that it has a valid HTTPS certificate.",
      ["Cancel", "Save anyway"],
    ],
  ]);
  await pressAlertButton("Save anyway");
  expect(saves).toEqual([server]);
});
