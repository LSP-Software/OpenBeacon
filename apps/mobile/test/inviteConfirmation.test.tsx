import { beforeEach, expect, mock, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import React, { act } from "react";
import { createRoot } from "test-renderer";
import type { InviteToConfirm } from "../lib/inviteTypes.ts";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const refusal = (code: string, message = code) =>
  TRPCClientError.from({ error: { code: -32000, data: { code }, message } });

const preview: {
  group: { id: string; name: string; image: null; memberCount: number };
  inviter: { name: string; image: null };
  alreadyMember: boolean;
  joinBlockedBy: "GROUP_LIMIT" | "PENDING_DELETION" | null;
} = {
  group: { id: "group-1", name: "Smith Family", image: null, memberCount: 4 },
  inviter: { name: "Alex Smith", image: null },
  alreadyMember: false,
  joinBlockedBy: null,
};
let previewState: {
  data?: typeof preview;
  error: unknown;
  isError: boolean;
  isPending: boolean;
};
let acceptError: Error | null;
let declineError: Error | null;
let pendingAccept: Promise<void> | null;
let focused: boolean;
let limitReached: boolean;
const calls: string[] = [];
const dismissals: unknown[] = [];
const alerts: string[] = [];
const invalidatePredicates: ((query: { queryKey: unknown[] }) => boolean)[] = [];

mock.module("@tanstack/react-query", () => ({ useQuery: () => previewState }));
mock.module("expo-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  router: { dismissTo: (target: unknown) => dismissals.push(target) },
  useNavigation: () => ({ isFocused: () => focused }),
}));
const PassThrough = ({ children, ...props }: { children?: React.ReactNode }) =>
  React.createElement("view", props, children);
mock.module("react-native", () => ({
  ...createReactNativeTestModule(),
  ActivityIndicator: () => null,
  ScrollView: PassThrough,
  View: PassThrough,
}));
const settle = async (name: string, error: Error | null) => {
  calls.push(name);
  if (pendingAccept && name.startsWith("accept")) await pendingAccept;
  if (error) throw error;
  return {};
};
mock.module("../lib/api.ts", () => ({
  queryClient: {
    invalidateQueries: async ({
      queryKey,
      predicate,
    }: {
      queryKey?: string[];
      predicate?: (query: { queryKey: unknown[] }) => boolean;
    }) => {
      if (predicate) invalidatePredicates.push(predicate);
      calls.push(`invalidate:${queryKey?.join(".") ?? "all"}`);
    },
  },
  trpc: { groupInvites: { list: { queryKey: () => ["invites"] } } },
  trpcClient: {
    groupInvites: {
      accept: { mutate: () => settle("accept", acceptError) },
      acceptShared: { mutate: () => settle("acceptShared", acceptError) },
      decline: { mutate: () => settle("decline", declineError) },
    },
  },
}));
mock.module("../lib/alert.ts", () => ({
  Alert: { alert: (title: string) => alerts.push(title) },
}));
mock.module("../lib/groupEncryption.ts", () => ({
  buildAcceptInviteInput: async () => ({}),
  buildAcceptSharedInviteInput: async () => ({}),
  submitEpochChange: async ({
    build,
    submit,
  }: {
    build: () => Promise<unknown>;
    submit: (input: unknown) => Promise<unknown>;
  }) => submit(await build()),
}));
mock.module("../lib/groupLimitAlert.ts", () => ({
  groupLimitAlert: () =>
    limitReached ? { title: "Too many groups", message: "Leave a group first." } : null,
}));
mock.module("../lib/trackingEvents.ts", () => ({
  requestTrackingSync: () => calls.push("sync"),
}));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({
    children,
    disabled,
    onPress,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onPress?: () => void;
  }) => React.createElement("pressable", { disabled: disabled ?? false, onPress }, children),
}));
mock.module("../components/ui/Avatar.tsx", () => ({
  Avatar: PassThrough,
  AvatarFallback: PassThrough,
  AvatarImage: () => null,
}));
mock.module("../components/ui/Text.tsx", () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement("text", null, children),
}));

const { InviteConfirmation } = await import("../components/InviteConfirmation.tsx");

let triedAnotherCode = false;
const render = async (invite: InviteToConfirm) => {
  const root = createRoot();
  await act(async () =>
    root.render(
      <InviteConfirmation
        invite={invite}
        onTryAnotherCode={() => {
          triedAnotherCode = true;
        }}
      />,
    ),
  );
  return root;
};
type Rendered = Awaited<ReturnType<typeof render>>;
const output = (root: Rendered) => JSON.stringify(root.container.toJSON());
const buttons = (root: Rendered) =>
  root.container
    .queryAll((node) => node.type === "pressable")
    .map((node) => ({ node, label: node.queryAll((child) => child.type === "text")[0]?.children }))
    .map(({ node, label }) => ({ node, label: label?.join("") }));
const button = (root: Rendered, label: string) => {
  const found = buttons(root).find((candidate) => candidate.label === label);
  if (!found) throw new Error(`Missing ${label} button`);
  return found.node;
};
const labels = (root: Rendered) => buttons(root).map(({ label }) => label);
const press = async (root: Rendered, label: string) => {
  const onPress = button(root, label).props["onPress"];
  if (typeof onPress !== "function") throw new Error(`${label} can't be pressed`);
  await act(async () => onPress());
};
const code: InviteToConfirm = { kind: "code", code: "0123456789ABCDEF0123456789ABCDEF" };
const email: InviteToConfirm = { kind: "email", inviteId: "invite-1" };
const showPreview = (changes: Partial<typeof preview>) => {
  previewState = {
    data: { ...preview, ...changes },
    error: null,
    isError: false,
    isPending: false,
  };
};
const failPreview = (error: unknown) => {
  previewState = { error, isError: true, isPending: false };
};

beforeEach(() => {
  showPreview({});
  acceptError = null;
  declineError = null;
  pendingAccept = null;
  focused = true;
  limitReached = false;
  triedAnotherCode = false;
  calls.length = 0;
  dismissals.length = 0;
  alerts.length = 0;
  invalidatePredicates.length = 0;
});

test("shows who invited you, the group and its size before asking", async () => {
  const root = await render(code);
  const text = output(root);
  for (const expected of [
    "Alex Smith",
    "invited you to join",
    "Smith Family",
    '"4"," ","members"',
    "Do you want to join this group?",
  ])
    expect(text).toContain(expected);
  expect(labels(root)).toEqual(["Join Group", "No"]);
  expect(text).toContain('"accessibilityLabel":"Alex Smith invited you to join Smith Family"');
});

test("a group of one says member, not members", async () => {
  showPreview({ group: { ...preview.group, memberCount: 1 } });
  const text = output(await render(code));
  expect(text).toContain('"1"," ","member"');
  expect(text).not.toContain('"members"');
});

test("Join Group accepts a code and returns to the groups list", async () => {
  const root = await render(code);
  await press(root, "Join Group");
  expect(calls).toEqual(["acceptShared", "invalidate:all", "sync"]);
  expect(dismissals).toEqual(["/(tabs)/groups/list"]);
});

test("Join Group accepts an email invite, refreshes groups, syncs and leaves", async () => {
  const root = await render(email);
  await press(root, "Join Group");
  expect(calls).toEqual(["accept", "invalidate:all", "sync"]);
  expect(dismissals).toEqual(["/(tabs)/groups/list"]);
});

test("joining refreshes everything except the used invite's preview", async () => {
  const root = await render(code);
  await press(root, "Join Group");
  const [predicate] = invalidatePredicates;
  expect(predicate?.({ queryKey: ["invitePreview", code] })).toBe(false);
  expect(predicate?.({ queryKey: [["groupMembership", "list"]] })).toBe(true);
  expect(output(root)).not.toContain("Invite unavailable");
});

test("while joining, both buttons are locked", async () => {
  let finish = () => {};
  pendingAccept = new Promise((resolve) => {
    finish = resolve;
  });
  const root = await render(email);
  let joining: unknown;
  await act(async () => {
    joining = button(root, "Join Group").props["onPress"]();
  });
  expect(button(root, "No").props["disabled"]).toBe(true);
  await act(async () => {
    finish();
    await joining;
  });
  expect(button(root, "No").props["disabled"]).toBe(false);
});

test("a join that finishes after the user left doesn't pull them back", async () => {
  const root = await render(code);
  focused = false;
  await press(root, "Join Group");
  expect(calls).toEqual(["acceptShared", "invalidate:all", "sync"]);
  expect(dismissals).toEqual([]);
});

test("hitting the group limit explains it and stays", async () => {
  limitReached = true;
  acceptError = new Error("limit");
  const root = await render(email);
  await press(root, "Join Group");
  expect(alerts).toEqual(["Too many groups"]);
  expect(dismissals).toEqual([]);
});

test("any other join failure says it couldn't join", async () => {
  acceptError = refusal("INTERNAL_SERVER_ERROR", "Something broke");
  const root = await render(email);
  await press(root, "Join Group");
  expect(alerts).toEqual(["Unable to join"]);
  expect(dismissals).toEqual([]);
});

test("No on a code leaves without telling the server", async () => {
  await press(await render(code), "No");
  expect(calls).toEqual([]);
  expect(dismissals).toEqual(["/(tabs)/groups/list"]);
});

test("No on an email invite declines it", async () => {
  await press(await render(email), "No");
  expect(calls).toEqual(["decline", "invalidate:invites"]);
  expect(dismissals).toEqual(["/(tabs)/groups/list"]);
});

test("a failed decline stays on the invite", async () => {
  declineError = new Error("offline");
  await press(await render(email), "No");
  expect(alerts).toEqual(["Unable to decline invite"]);
  expect(dismissals).toEqual([]);
});

test("an invite that expires while deciding shows it is unavailable", async () => {
  acceptError = refusal("NOT_FOUND");
  const root = await render(email);
  await press(root, "Join Group");
  expect(output(root)).toContain("Invite unavailable");
  expect(calls).toEqual(["accept", "invalidate:invites"]);
  expect(dismissals).toEqual([]);
});

test("a code the server can't find offers another try", async () => {
  failPreview(refusal("NOT_FOUND"));
  const root = await render(code);
  expect(output(root)).toContain("This code is wrong, has expired or was already used.");
  expect(labels(root)).toEqual(["Try another code", "Back to groups"]);
  await press(root, "Try another code");
  expect(triedAnotherCode).toBe(true);
});

test("an email invite the server can't find only goes back", async () => {
  failPreview(refusal("NOT_FOUND"));
  const root = await render(email);
  expect(output(root)).toContain("This invite has expired");
  expect(labels(root)).toEqual(["Back to groups"]);
});

test.each([
  [refusal("TOO_MANY_REQUESTS"), "Too many attempts. Wait a minute and try again."],
  [refusal("FORBIDDEN", "Not allowed here"), "Not allowed here"],
  [new TRPCClientError("Network request failed"), "Check your connection"],
])("a preview failure explains why", async (error, expected) => {
  failPreview(error);
  const root = await render(code);
  expect(output(root)).toContain(expected);
  expect(labels(root)).toEqual(["Try again", "Back"]);
});

test.each([
  ["GROUP_LIMIT" as const, "as many groups as your account allows"],
  ["PENDING_DELETION" as const, "scheduled for deletion"],
])("a %s block shows the group but not Join Group", async (joinBlockedBy, expected) => {
  showPreview({ joinBlockedBy });
  const codeRoot = await render(code);
  expect(output(codeRoot)).toContain("Smith Family");
  expect(output(codeRoot)).toContain(expected);
  expect(labels(codeRoot)).toEqual(["Back"]);
  expect(labels(await render(email))).toEqual(["Back", "Decline invite"]);
});

test("an existing member is offered the group instead of joining again", async () => {
  showPreview({ alreadyMember: true });
  const root = await render(code);
  expect(output(root)).toContain("already in this group");
  expect(labels(root)).toEqual(["Open group", "Back"]);
});
