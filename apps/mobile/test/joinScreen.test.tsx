import { beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";
import type { InviteToConfirm } from "../lib/inviteTypes.ts";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const alerts: string[][] = [];
const confirming: InviteToConfirm[] = [];

mock.module("expo-camera", () => ({
  CameraView: (props: { onBarcodeScanned: (scan: { data: string }) => void }) =>
    React.createElement("camera", props),
  useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })],
}));
mock.module("expo-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  router: {},
  useLocalSearchParams: () => ({}),
}));
mock.module("react-native", () => ({
  ...createReactNativeTestModule(),
  TextInput: () => null,
}));
mock.module("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("../lib/alert.ts", () => ({
  Alert: { alert: (title: string, message: string) => alerts.push([title, message]) },
}));
mock.module("../lib/storage.ts", () => ({ storage: {} }));
mock.module("../lib/registeredDevice.ts", () => ({ readRegisteredDeviceNow: () => null }));
mock.module("../lib/deviceActivation.ts", () => ({ readThisDeviceState: () => "active" }));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } }, isPending: false }) },
}));
mock.module("../components/InviteConfirmation.tsx", () => ({
  InviteConfirmation: ({ invite }: { invite: InviteToConfirm }) => {
    confirming.push(invite);
    return null;
  },
}));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) =>
    React.createElement("pressable", { onPress }, children),
}));
mock.module("../components/ui/Text.tsx", () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement("text", null, children),
}));

const { default: Join } = await import("../app/join.tsx");

const openScanner = async () => {
  const root = createRoot();
  await act(async () => root.render(<Join />));
  const scan = root.container
    .queryAll((node) => node.type === "pressable")
    .find((node) => JSON.stringify(node.toJSON()).includes("Scan QR code"));
  await act(async () => scan?.props["onPress"]());
  const camera = root.container.queryAll((node) => node.type === "camera")[0];
  const onBarcodeScanned = camera?.props["onBarcodeScanned"];
  if (typeof onBarcodeScanned !== "function") throw new Error("Scanner didn't open");
  return (data: string) => onBarcodeScanned({ data });
};

beforeEach(() => {
  alerts.length = 0;
  confirming.length = 0;
});

test("a QR code that isn't an invite is reported once, however many frames see it", async () => {
  const scanned = await openScanner();
  await act(async () => {
    scanned("https://example.test/");
    scanned("https://example.test/");
    scanned("https://example.test/");
  });
  expect(alerts).toEqual([["Invalid code", "That QR code isn’t an Open Beacon invite."]]);
  expect(confirming).toEqual([]);
});

test("a scanned invite link opens the confirmation for its code", async () => {
  const scanned = await openScanner();
  const code = "0123456789ABCDEF0123456789ABCDEF";
  await act(async () => {
    scanned(`openbeacon://join?code=${code.toLowerCase()}`);
    scanned("https://example.test/");
  });
  expect(alerts).toEqual([]);
  expect(confirming.at(-1)).toEqual({ kind: "code", code });
});
