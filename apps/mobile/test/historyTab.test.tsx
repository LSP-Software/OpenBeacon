import { expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let items: unknown[] = [];
const icon = (name: string) => () => React.createElement("icon", { name });

mock.module("@tanstack/react-query", () => ({
  useInfiniteQuery: () => ({
    data: { pages: [{ items, nextBefore: null }] },
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    hasNextPage: false,
  }),
}));
mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));
mock.module("react-native", () => createReactNativeTestModule());
mock.module("nativewind", () => ({ cssInterop: () => {} }));
mock.module("lucide-react-native", () => ({
  ImageIcon: icon("Image"),
  LogInIcon: icon("LogIn"),
  LogOutIcon: icon("LogOut"),
  MapPinMinusIcon: icon("MapPinMinus"),
  MapPinPenIcon: icon("MapPinPen"),
  MapPinPlusIcon: icon("MapPinPlus"),
  PencilIcon: icon("Pencil"),
  ShieldIcon: icon("Shield"),
  SparklesIcon: icon("Sparkles"),
  UserMinusIcon: icon("UserMinus"),
  UserPlusIcon: icon("UserPlus"),
  UserXIcon: icon("UserX"),
}));
mock.module("../lib/api.ts", () => ({ trpcClient: {} }));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));
mock.module("../lib/storage.ts", () => ({
  storage: { getNumber: () => undefined, set: () => {} },
}));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("../components/ui/Text.tsx", () => ({
  Text: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("../hooks/useMemberNames.ts", () => ({ useMemberNames: () => () => null }));

const { default: HistoryTab } = await import("../components/groups/HistoryTab.tsx");

const event = (type: string, id: string) => ({
  kind: "group",
  id,
  at: new Date(),
  type,
  role: null,
  name: null,
  previousName: null,
  emoji: null,
  actor: { userId: "user-2", name: "Sam" },
  subject: { userId: "user-3", name: "Alex" },
});

const render = async () => {
  const root = createRoot();
  await act(async () => root.render(<HistoryTab groupId="group-1" active />));
  const text = JSON.stringify(root.container.children);
  await act(async () => root.unmount());
  return text;
};

test("an event type a newer server added is left out and the rest of the history still shows", async () => {
  items = [event("MEMBER_REMOVED", "known"), event("SEATS_CHANGED", "unknown")];

  const text = await render();

  expect(text).toContain("Sam removed Alex");
  expect(text).not.toContain("SEATS_CHANGED");
});

test("a day holding only events this build doesn't know shows the empty message", async () => {
  items = [event("SEATS_CHANGED", "unknown")];

  expect(await render()).toContain("Nothing has happened in the last 14 days.");
});
