import { beforeEach, describe, expect, mock, test } from "bun:test";
import React, { act, useState } from "react";
import { createRoot, type Root } from "test-renderer";
import { createReactNativeTestModule } from "../../test/reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let states: Record<string, "active" | "used" | "expired">;
let memberIds: string[] | undefined;
let statusRequests: string[][];
let created: number;
const setOpen = mock((_open: boolean) => {});
const focusListeners = new Set<(focused: boolean) => void>();

mock.module("react-native", () => ({
  ...createReactNativeTestModule(),
  Alert: { alert: () => {} },
  Share: { share: async () => ({}) },
}));
mock.module("../BrandedQrCode.tsx", () => ({
  BrandedQrCode: ({ value }: { value: string }) => React.createElement("qr", { value }),
}));
mock.module("../ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) =>
    React.createElement("button", { type: "button", onClick: onPress }, children),
}));
mock.module("../ui/Text.tsx", () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement("text", null, children),
}));
mock.module("@tanstack/react-query", () => ({
  focusManager: {
    subscribe: (listener: (focused: boolean) => void) => {
      focusListeners.add(listener);
      return () => focusListeners.delete(listener);
    },
  },
  useMutation: () => {
    const [data, setData] = useState<{ id: string; code: string; expiresInMs: number }>();
    const [reset] = useState(() => () => setData(undefined));
    return {
      data,
      reset,
      isPending: false,
      mutateAsync: async () => {
        created += 1;
        const invite = {
          id: `invite-${created}`,
          code: String(created).repeat(32),
          expiresInMs: 300_000,
        };
        setData(invite);
        return invite;
      },
    };
  },
  useQuery: (
    options:
      | { kind: "list"; select: (groups: unknown[]) => unknown }
      | { kind: "statuses"; inviteIds: string[] },
  ) => {
    const [data, setData] = useState<{ id: string; status: string }[]>();
    if (options.kind === "list") {
      return {
        data:
          memberIds &&
          options.select([
            { id: "group-1", members: memberIds.map((id) => ({ id })) },
            { id: "group-2", members: [{ id: "other" }] },
          ]),
      };
    }
    return {
      data,
      refetch: async () => {
        statusRequests.push(options.inviteIds);
        setData(
          options.inviteIds.flatMap((id) => (states[id] ? [{ id, status: states[id] }] : [])),
        );
      },
    };
  },
}));
mock.module("../../lib/api.ts", () => ({
  trpc: {
    groupInvites: {
      createShared: { mutationOptions: () => ({}) },
      sharedStatuses: {
        queryOptions: (input: { inviteIds: string[] }) => ({ ...input, kind: "statuses" }),
      },
    },
    groupMembership: { list: { queryOptions: () => ({ kind: "list" }) } },
  },
}));
const { SharedInvite } = await import("./SharedInvite.tsx");
const createInvite = async (root: Root) => {
  await act(async () => {
    const buttons = root.container.queryAll((item) => item.type === "button");
    const button = buttons[buttons.length - 1];
    if (!button) throw new Error("Create invitation button not found");
    (button.props as { onClick?: () => void }).onClick?.();
    await Promise.resolve();
  });
};

const render = async (root: Root, value: "link" | "qr" = "qr") => {
  await act(async () => {
    root.render(<SharedInvite groupId="group-1" open setOpen={setOpen} value={value} />);
    await Promise.resolve();
  });
};

describe("shared invitation dialog", () => {
  beforeEach(() => {
    states = {};
    memberIds = ["owner"];
    statusRequests = [];
    created = 0;
    setOpen.mockClear();
  });
  test("checks the latest invite only when someone joins, and closes once it is used", async () => {
    const root = createRoot();
    await render(root, "link");
    await createInvite(root);
    expect(JSON.stringify(root.container.toJSON())).toContain("1".repeat(32));
    await render(root);
    expect(root.container.queryAll((item) => item.type === "qr")[0]?.props["value"]).toBe(
      "1".repeat(32),
    );
    expect(statusRequests).toEqual([]);

    await createInvite(root);
    await render(root);
    expect(statusRequests).toEqual([]);

    states = { "invite-1": "used", "invite-2": "active" };
    memberIds = ["owner", "first-joiner"];
    await render(root);
    expect(statusRequests).toEqual([["invite-2"]]);
    expect(setOpen).not.toHaveBeenCalled();

    await render(root);
    expect(statusRequests).toEqual([["invite-2"]]);

    states = { "invite-1": "used", "invite-2": "used" };
    memberIds = ["owner", "first-joiner", "second-joiner"];
    await render(root);
    await render(root);
    expect(statusRequests).toEqual([["invite-2"], ["invite-2"]]);
    expect(setOpen).toHaveBeenCalledWith(false);
    await act(async () => root.unmount());
  });
  test("treats the first loaded member list as a baseline rather than a join", async () => {
    const root = createRoot();
    memberIds = undefined;
    await render(root);
    await createInvite(root);
    await render(root);
    memberIds = ["owner"];
    await render(root);
    expect(statusRequests).toEqual([]);

    states = { "invite-1": "used" };
    memberIds = ["owner", "joiner"];
    await render(root);
    await render(root);
    expect(statusRequests).toEqual([["invite-1"]]);
    expect(setOpen).toHaveBeenCalledWith(false);
    await act(async () => root.unmount());
  });
  test("checks the invite again when the app comes back to the foreground", async () => {
    const root = createRoot();
    await render(root);
    await createInvite(root);
    await render(root);
    states = { "invite-1": "used" };
    await act(async () => {
      for (const listener of focusListeners) listener(false);
    });
    expect(statusRequests).toEqual([]);
    await act(async () => {
      for (const listener of focusListeners) listener(true);
    });
    await render(root);
    expect(statusRequests).toEqual([["invite-1"]]);
    expect(setOpen).toHaveBeenCalledWith(false);
    await act(async () => root.unmount());
    expect(focusListeners.size).toBe(0);
  });
  test("does not close for expired, unavailable, or prior-dialog invitations", async () => {
    const root = createRoot();
    await render(root);
    await createInvite(root);
    states = { "invite-1": "expired", "previous-dialog": "used" };
    memberIds = ["owner", "joiner"];
    await render(root);
    await render(root);
    expect(JSON.stringify(root.container.toJSON())).toContain("expired");
    expect(setOpen).not.toHaveBeenCalled();
    states = {};
    memberIds = ["owner"];
    await render(root);
    await render(root);
    expect(setOpen).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
