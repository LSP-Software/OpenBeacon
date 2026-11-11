import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { readdirSync } from "node:fs";
import path from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let session: { data: { user: { id: string } } | null; isPending: boolean };
let thisDeviceState: "unregistered" | "registered" | "active";

const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
const Stack = Object.assign(
  ({ children }: { children?: React.ReactNode }) => React.createElement("stack", null, children),
  {
    Screen: ({ name }: { name: string }) => React.createElement("screen", { name }),
    Protected: ({ children, guard }: { children?: React.ReactNode; guard: boolean }) =>
      React.createElement("protected", { guard }, children),
  },
);

mock.module("expo-router", () => ({ Stack }));
mock.module("../global.css", () => ({}));
mock.module("@rn-primitives/portal", () => ({ PortalHost: () => null }));
mock.module("@tanstack/react-query", () => ({ QueryClientProvider: Passthrough }));
mock.module("../components/ApiCompatibilityGate.tsx", () => ({
  ApiCompatibilityGate: () => null,
  useApiCompatibilityGateShown: () => false,
}));
mock.module("../components/ui/Alert.tsx", () => ({ AlertHost: () => null }));
mock.module("../components/OfflineBanner.tsx", () => ({ OfflineBanner: () => null }));
mock.module("../lib/api.ts", () => ({ queryClient: {} }));
mock.module("../lib/auth-client.ts", () => ({ authClient: { useSession: () => session } }));
mock.module("../lib/deviceActivation.ts", () => ({
  useThisDeviceState: () => thisDeviceState,
}));
mock.module("../providers/DeletionCancellationNotice.tsx", () => ({
  DeletionCancellationNotice: () => null,
}));
mock.module("../providers/LocationPermissionProvider.tsx", () => ({
  LocationPermissionProvider: Passthrough,
}));
mock.module("../providers/SessionDataCleanup.tsx", () => ({ SessionDataCleanup: () => null }));
mock.module("../providers/ThemeProvider.tsx", () => ({ ThemeProvider: Passthrough }));
mock.module("../providers/TrackingProvider.tsx", () => ({ TrackingProvider: Passthrough }));

const { default: RootLayout } = await import("../app/_layout.tsx");

const setupRoutes = [
  "index",
  "signIn",
  "signUp",
  "forgotPassword",
  "serverUrl",
  "device-removed",
  "setup/index",
  "setup/link",
  "setup/waiting",
  "account/recovery-restore",
  "account/recovery-reset",
];

const appDirectory = path.join(import.meta.dir, "../app");

const rootRoutes = (directory: string, prefix = ""): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      const nested = path.join(directory, entry.name);
      const hasLayout = readdirSync(nested).includes("_layout.tsx");
      return hasLayout ? [`${prefix}${entry.name}`] : rootRoutes(nested, `${prefix}${entry.name}/`);
    }
    if (!entry.name.endsWith(".tsx") || entry.name === "_layout.tsx" || entry.name.startsWith("+"))
      return [];
    return [`${prefix}${entry.name.replace(/\.tsx$/, "")}`];
  });

let root: Root | null = null;

const render = async () => {
  root = createRoot();
  await act(async () => root?.render(<RootLayout />));
  const [protectedGroup] = root.container.queryAll((item) => item.type === "protected");
  if (!protectedGroup) throw new Error("Missing protected routes");
  return {
    guard: (protectedGroup.props as { guard: boolean }).guard,
    protectedRoutes: protectedGroup
      .queryAll((item) => item.type === "screen")
      .map((screen) => (screen.props as { name: string }).name),
  };
};

beforeEach(() => {
  session = { data: { user: { id: "user-1" } }, isPending: false };
  thisDeviceState = "active";
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

test("every route except setup and the signed-out screens is protected", async () => {
  const { protectedRoutes } = await render();
  const expected = rootRoutes(appDirectory).filter((route) => !setupRoutes.includes(route));
  expect(protectedRoutes.toSorted()).toEqual(expected.toSorted());
  for (const route of setupRoutes) expect(rootRoutes(appDirectory)).toContain(route);
});

test("a signed-in phone that isn't set up can only reach setup", async () => {
  thisDeviceState = "registered";
  expect((await render()).guard).toBe(false);
});

test("a signed-in phone that isn't registered yet can only reach setup", async () => {
  thisDeviceState = "unregistered";
  expect((await render()).guard).toBe(false);
});

test("a set-up phone reaches the whole app", async () => {
  expect((await render()).guard).toBe(true);
});

test("a set-up phone keeps the whole app while the session is loading", async () => {
  session = { data: null, isPending: true };
  expect((await render()).guard).toBe(true);
});

test("a phone that isn't set up can't reach the app while the session is loading", async () => {
  session = { data: null, isPending: true };
  thisDeviceState = "registered";
  expect((await render()).guard).toBe(false);
});

test("signed out, every route works as before so invite links still open", async () => {
  session = { data: null, isPending: false };
  thisDeviceState = "registered";
  expect((await render()).guard).toBe(true);
  await act(async () => root?.unmount());
  session = { data: null, isPending: true };
  thisDeviceState = "unregistered";
  expect((await render()).guard).toBe(true);
});
