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
const copied: string[] = [];
const shared: string[] = [];
const requestedKinds: string[] = [];
let baseUrl = "https://api.openbeacon.net";
const focusListeners = new Set<(focused: boolean) => void>();

mock.module("react-native", () => ({
  ...createReactNativeTestModule(),
  Alert: { alert: () => {} },
  Share: {
    share: async ({ message }: { message: string }) => {
      shared.push(message);
      return {};
    },
  },
}));
mock.module("../../lib/currentServer.ts", () => ({
  getBaseUrl: () => baseUrl,
  isHostedServer: (url: string) => url === "https://api.openbeacon.net",
  normaliseServerUrl: (url: string) => ({ url, error: null }),
}));
mock.module("expo-clipboard", () => ({
  setStringAsync: async (text: string) => {
    copied.push(text);
    return true;
  },
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
      mutateAsync: async ({ kind }: { kind: "link" | "qr" }) => {
        created += 1;
        requestedKinds.push(kind);
        const invite = {
          id: `invite-${created}`,
          code: String(created).repeat(32),
          expiresInMs: kind === "link" ? 1_800_000 : 300_000,
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

const shareLink = async (root: Root) => {
  const share = root.container
    .queryAll((item) => item.type === "button")
    .find((item) => JSON.stringify(item.children).includes("Share link"));
  if (!share) throw new Error("Share link button not found");
  await act(async () => {
    (share.props as { onClick?: () => void }).onClick?.();
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
    copied.length = 0;
    shared.length = 0;
    baseUrl = "https://api.openbeacon.net";
  });
  test("copies just the code and resets the copied label for a new invite", async () => {
    const root = createRoot();
    await render(root, "link");
    await createInvite(root);
    const copyButton = () => {
      const button = root.container
        .queryAll((item) => item.type === "button")
        .find((item) => /Copy code|Copied/.test(JSON.stringify(item.children)));
      if (!button) throw new Error("Copy code button not found");
      return button;
    };
    await act(async () => {
      (copyButton().props as { onClick?: () => void }).onClick?.();
      await Promise.resolve();
    });
    expect(copied).toEqual(["1".repeat(32)]);
    expect(JSON.stringify(copyButton().children)).toContain("Copied");
    await createInvite(root);
    expect(JSON.stringify(copyButton().children)).toContain("Copy code");
    await act(async () => root.unmount());
  });
  test("checks the latest invite only when someone joins, and closes once it is used", async () => {
    const root = createRoot();
    await render(root, "link");
    await createInvite(root);
    expect(JSON.stringify(root.container.toJSON())).toContain("1".repeat(32));
    await render(root);
    expect(root.container.queryAll((item) => item.type === "qr")[0]?.props["value"]).toBe(
      `openbeacon://join?code=${"1".repeat(32)}&server=https%3A%2F%2Fapi.openbeacon.net`,
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
  test("a link invite lasts 30 minutes and a QR invite 5, as the server says", async () => {
    requestedKinds.length = 0;
    const root = createRoot();
    await render(root, "link");
    await createInvite(root);
    expect(JSON.stringify(root.container.toJSON())).toContain("Valid for 30 minutes and one use.");
    await render(root, "qr");
    await createInvite(root);
    expect(JSON.stringify(root.container.toJSON())).toContain("Valid for 5 minutes and one use.");
    expect(requestedKinds).toEqual(["link", "qr"]);
    await act(async () => root.unmount());
  });
  test("a hosted invite's message names no host but its link still names the server", async () => {
    const root = createRoot();
    await render(root, "link");
    await createInvite(root);
    await shareLink(root);
    expect(shared).toEqual([
      `Join my OpenBeacon group. Install OpenBeacon, then open this link: openbeacon://join?code=${"1".repeat(32)}&server=https%3A%2F%2Fapi.openbeacon.net`,
    ]);
    await act(async () => root.unmount());
  });
  test("a self-hosted invite's QR code and shared link name the server", async () => {
    baseUrl = "https://beacon.example.com";
    const root = createRoot();
    await render(root);
    await createInvite(root);
    const link = `openbeacon://join?code=${"1".repeat(32)}&server=https%3A%2F%2Fbeacon.example.com`;
    expect(root.container.queryAll((item) => item.type === "qr")[0]?.props["value"]).toBe(link);

    await render(root, "link");
    await shareLink(root);
    expect(shared).toEqual([
      `Join my OpenBeacon group on beacon.example.com. Install OpenBeacon, then open this link: ${link}`,
    ]);
    await act(async () => root.unmount());
  });
});
