import { beforeEach, describe, expect, mock, test } from "bun:test";
import React, { act, useState } from "react";
import { createRoot, type Root } from "test-renderer";
import { createReactNativeTestModule } from "../../test/reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let states: Record<string, "active" | "used" | "expired">;
let requestedIds: string[];
let created: number;
let enabled: boolean;
const invalidate = mock(async () => {});
const setOpen = mock((_open: boolean) => {});
const queryClient = { invalidateQueries: invalidate };

mock.module("react-native", () => ({
  ...createReactNativeTestModule(),
  Alert: { alert: () => {} },
  Share: { share: async () => ({}) },
}));
mock.module("react-native-qrcode-svg", () => ({
  default: ({ value }: { value: string }) => React.createElement("qr", { value }),
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
  useQuery: (options: { enabled: boolean; inviteIds: string[] }) => {
    enabled = options.enabled;
    requestedIds = options.inviteIds;
    return {
      data: enabled
        ? options.inviteIds.flatMap((id) => (states[id] ? [{ id, status: states[id] }] : []))
        : undefined,
    };
  },
  useQueryClient: () => queryClient,
}));
mock.module("../../lib/api.ts", () => ({
  trpc: {
    groupInvites: {
      createShared: { mutationOptions: () => ({}) },
      sharedStatuses: { queryOptions: (input: { inviteIds: string[] }) => input },
    },
    groupMembership: {
      members: { queryKey: () => ["members"] },
      get: { queryKey: () => ["get"] },
      list: { queryKey: () => ["list"] },
    },
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

describe("shared invitation dialog", () => {
  beforeEach(() => {
    states = {};
    requestedIds = [];
    created = 0;
    enabled = false;
    invalidate.mockClear();
    setOpen.mockClear();
  });
  test("shares one code across link and QR and closes only when the latest invite is used", async () => {
    const root = createRoot();
    await act(async () => {
      root.render(<SharedInvite groupId="group-1" open setOpen={setOpen} value="link" />);
    });
    expect(enabled).toBe(false);
    await createInvite(root);
    expect(requestedIds).toEqual(["invite-1"]);
    expect(JSON.stringify(root.container.toJSON())).toContain("1".repeat(32));
    await act(async () => {
      root.render(<SharedInvite groupId="group-1" open setOpen={setOpen} value="qr" />);
    });
    expect(root.container.queryAll((item) => item.type === "qr")[0]?.props["value"]).toBe(
      "1".repeat(32),
    );
    await createInvite(root);
    states = { "invite-1": "used", "invite-2": "active" };
    await act(async () => {
      root.render(<SharedInvite groupId="group-1" open setOpen={setOpen} value="qr" />);
      await Promise.resolve();
    });
    expect(setOpen).not.toHaveBeenCalled();
    expect(requestedIds).toEqual(["invite-2"]);
    expect(invalidate).not.toHaveBeenCalled();
    states = { "invite-1": "used", "invite-2": "used" };
    await act(async () => {
      root.render(<SharedInvite groupId="group-1" open setOpen={setOpen} value="qr" />);
    });
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(invalidate).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
  });
  test("does not close for expired, unavailable, or prior-dialog invitations", async () => {
    const root = createRoot();
    await act(async () => {
      root.render(<SharedInvite groupId="group-1" open setOpen={setOpen} value="qr" />);
    });
    await createInvite(root);
    states = { "invite-1": "expired", "previous-dialog": "used" };
    await act(async () => {
      root.render(<SharedInvite groupId="group-1" open setOpen={setOpen} value="qr" />);
    });
    expect(JSON.stringify(root.container.toJSON())).toContain("expired");
    expect(setOpen).not.toHaveBeenCalled();
    states = {};
    await act(async () => {
      root.render(<SharedInvite groupId="group-1" open setOpen={setOpen} value="qr" />);
    });
    expect(setOpen).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
