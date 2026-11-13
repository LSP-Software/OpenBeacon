import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const alerts: unknown[][] = [];
const back = mock(() => {});
let scan: ((event: { data: string }) => void) | undefined;
const link = {
  device: { deviceId: "device-new", model: "Pixel 9", name: "New phone", publicKey: "key" },
  devicePublicKey: "key",
  linkId: "link-1",
  psk: new Uint8Array(32),
};
const approveDeviceLink = mock(async (_link: typeof link): Promise<void> => {});
const decline = mock(async (_input: { linkId: string }): Promise<void> => {});

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("expo-router", () => ({ router: { back } }));
mock.module("expo-camera", () => ({
  CameraView: ({ onBarcodeScanned }: { onBarcodeScanned?: (event: { data: string }) => void }) => {
    scan = onBarcodeScanned;
    return null;
  },
  useCameraPermissions: () => [{ canAskAgain: true, granted: true }, async () => ({})],
}));
mock.module("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
mock.module("react-native", () => ({
  Linking: { openSettings: async () => {} },
  ScrollView: View,
  View,
}));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../components/headers/BackButton.tsx", () => ({ BackButton: () => null }));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../lib/alert.ts", () => ({
  Alert: {
    alert: (...args: unknown[]) => {
      alerts.push(args);
    },
  },
}));
mock.module("../lib/api.ts", () => ({
  trpc: { account: { listDevices: { queryKey: () => [] } } },
  trpcClient: { deviceLink: { decline: { mutate: decline } } },
}));
mock.module("../lib/deviceLink.ts", () => ({
  approveDeviceLink,
  lookUpDeviceLink: async () => link,
}));

const { default: AddDeviceScreen } = await import("../app/account/add-device.tsx");

let root: Root | null = null;

const rendered = () => JSON.stringify(root?.container.toJSON());

const pressButton = async (label: string) => {
  const button = root?.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes(label));
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => (button.props as { onPress: () => void }).onPress());
};

const scanCode = async () => {
  root ??= createRoot();
  await act(async () => root?.render(<AddDeviceScreen />));
  await act(async () => scan?.({ data: "code" }));
  expect(rendered()).toContain("to your account?");
};

const refused = (
  code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT",
  message: string,
  reason: "CODE_EXPIRED" | "ALREADY_SET_UP" | null,
) => TRPCClientError.from({ error: { code: -32600, data: { code, reason }, message } });

beforeEach(() => {
  alerts.length = 0;
  back.mockClear();
  approveDeviceLink.mockReset();
  decline.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

test("an Add refused because the code expired or was replaced goes back to scanning", async () => {
  for (const [code, reason] of [
    ["BAD_REQUEST", "CODE_EXPIRED"],
    ["NOT_FOUND", "CODE_EXPIRED"],
    ["CONFLICT", "ALREADY_SET_UP"],
  ] as const) {
    const message = `This code is no longer valid (${code}).`;
    approveDeviceLink.mockImplementationOnce(async () => {
      throw refused(code, message, reason);
    });
    await scanCode();
    await pressButton("Add");

    expect(alerts).toEqual([]);
    expect(rendered()).toContain(message);
    expect(rendered()).not.toContain("Not me");
    await act(async () => scan?.({ data: "code" }));
    expect(rendered()).toContain("to your account?");
    if (root) await act(async () => root?.unmount());
    root = null;
  }
});

test("an Add that fails for another reason stays on the confirm step with an alert", async () => {
  approveDeviceLink.mockImplementationOnce(async () => {
    throw new TRPCClientError("Network request failed");
  });
  await scanCode();
  await pressButton("Add");

  expect(alerts.map(([title]) => title)).toEqual(["Unable to add New phone"]);
  expect(rendered()).toContain("Not me");
});

test("an Add refused for a bad request without a reason keeps the code and alerts", async () => {
  approveDeviceLink.mockImplementationOnce(async () => {
    throw refused("BAD_REQUEST", "Invalid input", null);
  });
  await scanCode();
  await pressButton("Add");

  expect(alerts).toEqual([["Unable to add New phone", "Invalid input"]]);
  expect(rendered()).toContain("Not me");
});

test("Not me refused because the code was replaced goes back to scanning", async () => {
  const message = "This code is no longer valid. Scan the new one.";
  decline.mockImplementationOnce(async () => {
    throw refused("NOT_FOUND", message, "CODE_EXPIRED");
  });
  await scanCode();
  await pressButton("Not me");

  expect(alerts).toEqual([]);
  expect(rendered()).toContain(message);
  expect(rendered()).not.toContain("Not me");
  expect(back).not.toHaveBeenCalled();
});
