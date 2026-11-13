import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { MutationObserver, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const storageValues = new Map<string, string>();
let sessionState: { data: { user: { id: string } } | null; isPending: boolean } = {
  data: null,
  isPending: true,
};
const notify = mock((_signal: string) => {});
const settledUsers: Array<string | null> = [];

mock.module("../lib/storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
    remove: (key: string) => storageValues.delete(key),
    getAllKeys: () => [...storageValues.keys()],
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => sessionState, $store: { notify } },
}));

mock.module("../lib/endSession.ts", () => ({
  settleLostSessions: async ({ userId }: { userId: string | null }) => {
    settledUsers.push(userId);
  },
}));

const { SessionDataCleanup } = await import("./SessionDataCleanup.tsx");
const { getGroupColor, setGroupColor } = await import("../lib/groupColor.ts");
const { getTrackingUploadTime, recordTrackingUpload } =
  await import("../lib/trackingUploadTime.ts");

let root: Root | null = null;
let queryClient: QueryClient;

const render = async () => {
  await act(async () => {
    if (!root) root = createRoot();
    root.render(
      <QueryClientProvider client={queryClient}>
        <SessionDataCleanup />
      </QueryClientProvider>,
    );
  });
};

const signIn = (id: string) => {
  sessionState = { data: { user: { id } }, isPending: false };
};

const signOut = () => {
  sessionState = { data: null, isPending: false };
};

const seedSessionData = () => {
  queryClient.setQueryData(["personalNicknames", "user-1"], { "member-1": "Mum" });
  setGroupColor("group-1", "#2A9D8F");
  recordTrackingUpload("device-1", "group-1", "2026-11-07T12:00:00.000Z");
  storageValues.set("server.url", "https://beacon.example");
};

const expectSessionDataCleared = () => {
  expect(queryClient.getQueryData(["personalNicknames", "user-1"])).toBeUndefined();
  expect(getGroupColor("group-1")).toBe("#FF1464");
  expect(getTrackingUploadTime("device-1", ["group-1"])).toBeNull();
  expect(storageValues.get("server.url")).toBe("https://beacon.example");
};

const unauthorized = () =>
  TRPCClientError.from({
    error: { message: "UNAUTHORIZED", code: -32001, data: { code: "UNAUTHORIZED" } },
  });

beforeEach(() => {
  storageValues.clear();
  sessionState = { data: null, isPending: true };
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  notify.mockClear();
  settledUsers.length = 0;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  queryClient.clear();
});

test("clears decrypted data when the user signs out", async () => {
  signIn("user-1");
  await render();
  seedSessionData();

  signOut();
  await render();

  expectSessionDataCleared();
});

test("clears the previous user's data when another user signs in", async () => {
  signIn("user-1");
  await render();
  seedSessionData();

  signIn("user-2");
  await render();

  expectSessionDataCleared();
});

test("clears data left behind when the app starts signed out", async () => {
  seedSessionData();
  await render();
  expect(getGroupColor("group-1")).toBe("#2A9D8F");

  signOut();
  await render();

  expectSessionDataCleared();
});

test("keeps data when the app starts with an existing session", async () => {
  seedSessionData();
  await render();
  signIn("user-1");
  await render();

  expect(queryClient.getQueryData<Record<string, string>>(["personalNicknames", "user-1"])).toEqual(
    { "member-1": "Mum" },
  );
  expect(getGroupColor("group-1")).toBe("#2A9D8F");
});

test("rechecks the session once when the server rejects it", async () => {
  signIn("user-1");
  await render();

  await act(async () => {
    await queryClient
      .fetchQuery({ queryKey: ["groups"], queryFn: () => Promise.reject(unauthorized()) })
      .catch(() => {});
    await new MutationObserver(queryClient, { mutationFn: () => Promise.reject(unauthorized()) })
      .mutate()
      .catch(() => {});
  });

  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith("$sessionSignal");
});

test("ignores other errors and rejections after sign-out", async () => {
  signIn("user-1");
  await render();

  await act(async () => {
    await queryClient
      .fetchQuery({
        queryKey: ["groups"],
        queryFn: () =>
          Promise.reject(
            TRPCClientError.from({
              error: { message: "FORBIDDEN", code: -32003, data: { code: "FORBIDDEN" } },
            }),
          ),
      })
      .catch(() => {});
  });
  signOut();
  await render();
  await act(async () => {
    await queryClient
      .fetchQuery({ queryKey: ["account"], queryFn: () => Promise.reject(unauthorized()) })
      .catch(() => {});
  });

  expect(notify).not.toHaveBeenCalled();
});

test("settles sessions lost earlier whenever the signed-in account is known", async () => {
  await render();
  expect(settledUsers).toEqual([]);

  signOut();
  await render();
  signIn("user-2");
  await render();

  expect(settledUsers).toEqual([null, "user-2"]);
});
