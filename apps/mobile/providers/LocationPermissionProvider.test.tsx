import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let sessionState: {
  data: null | {
    user: {
      id: string;
      name: string;
      email: string;
    };
    session: {
      token: string;
    };
  };
  isPending: boolean;
};
let refreshCalls = 0;
let foregroundRequestCalls = 0;
let backgroundRequestCalls = 0;
let settingsCalls = 0;
let refreshResult: import("../lib/locationPermissions.ts").LocationPermissionState;
let foregroundRequestResult: import("../lib/locationPermissions.ts").LocationPermissionState;
let backgroundRequestResult: import("../lib/locationPermissions.ts").LocationPermissionState;
let appStateListener: ((nextAppState: string) => void) | null = null;

mock.module("react-native", () =>
  createReactNativeTestModule({
    appState: {
      currentState: "active",
      addEventListener: (_event: string, listener: (nextAppState: string) => void) => {
        appStateListener = listener;

        return {
          remove: () => {
            if (appStateListener === listener) {
              appStateListener = null;
            }
          },
        };
      },
    },
    platformOS: "ios",
  }),
);

mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) =>
    React.createElement("button", { onClick: onPress, type: "button" }, children),
}));

mock.module("../components/ui/Dialog.tsx", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? React.createElement(React.Fragment, null, children) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("dialog-content", null, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) =>
    React.createElement("dialog-description", null, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) =>
    React.createElement("dialog-footer", null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("dialog-header", null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement("dialog-title", null, children),
}));

mock.module("../components/ui/Text.tsx", () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement("text", null, children),
}));

mock.module("../lib/auth-client.ts", () => ({
  authClient: {
    useSession: () => sessionState,
  },
}));

let thisDeviceState: "unregistered" | "registered" | "active" = "active";
let pathname = "/map";
let searchParams: { setup?: string } = {};
mock.module("expo-router", () => ({
  useGlobalSearchParams: () => searchParams,
  usePathname: () => pathname,
}));
mock.module("../lib/deviceActivation.ts", () => ({
  useThisDeviceState: () => thisDeviceState,
}));

mock.module("../lib/locationPermissions.ts", () => ({
  getLocationPermissionState: async () => {
    refreshCalls += 1;
    return refreshResult;
  },
  openLocationSettings: async () => {
    settingsCalls += 1;
  },
  requestForegroundLocationPermissions: async () => {
    foregroundRequestCalls += 1;
    return foregroundRequestResult;
  },
  requestBackgroundLocationPermissions: async () => {
    backgroundRequestCalls += 1;
    return backgroundRequestResult;
  },
}));

mock.module("../lib/notifications.ts", () => ({
  dismissNotice: async () => {},
}));

const {
  LocationPermissionProvider,
  useLocationPermissions,
}: typeof import("./LocationPermissionProvider.tsx") =
  await import("./LocationPermissionProvider.tsx");

const createPermissionState = ({
  foregroundStatus = "granted",
  backgroundStatus = "denied",
  preciseEnabled = true,
  canRequestBackgroundInApp = true,
  missing = ["background"],
}: {
  foregroundStatus?: "granted" | "denied" | "undetermined";
  backgroundStatus?: "granted" | "denied" | "undetermined";
  preciseEnabled?: boolean;
  canRequestBackgroundInApp?: boolean;
  missing?: import("../lib/locationPermissions.ts").LocationPermissionRequirement[];
}): import("../lib/locationPermissions.ts").LocationPermissionState => ({
  foregroundStatus,
  backgroundStatus,
  preciseEnabled,
  canRequestBackgroundInApp,
  isReadyForSharing: missing.length === 0,
  shouldShowAccountWarning: missing.length > 0,
  missing,
});

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const renderProvider = async (children: React.ReactNode = null) => {
  const root = createRoot();

  await act(async () => {
    root.render(<LocationPermissionProvider>{children}</LocationPermissionProvider>);
    await Promise.resolve();
  });

  return root;
};

const getRenderedOutput = (root: Root) => JSON.stringify(root.container.toJSON());

const getButtons = (root: Root) =>
  root.container.queryAll((instance) => instance.type === "button");

const pressButton = (root: Root, buttonIndex: number) => {
  const button = getButtons(root)[buttonIndex];

  if (!button) {
    throw new Error(`Missing button at index ${buttonIndex}`);
  }

  const props = button.props as {
    onClick?: () => void;
  };

  props.onClick?.();
};

const AccountWarning = () => {
  const { openLocationPermissionSettings } = useLocationPermissions();
  return (
    <button type="button" onClick={openLocationPermissionSettings}>
      Grant access
    </button>
  );
};

describe("LocationPermissionProvider", () => {
  beforeEach(() => {
    sessionState = {
      data: {
        user: {
          id: "user-1",
          name: "Test User",
          email: "test@example.com",
        },
        session: {
          token: "token-1",
        },
      },
      isPending: false,
    };
    refreshCalls = 0;
    foregroundRequestCalls = 0;
    backgroundRequestCalls = 0;
    settingsCalls = 0;
    refreshResult = createPermissionState({});
    foregroundRequestResult = createPermissionState({});
    backgroundRequestResult = createPermissionState({
      backgroundStatus: "granted",
      canRequestBackgroundInApp: false,
      missing: [],
    });
    appStateListener = null;
    thisDeviceState = "active";
    pathname = "/map";
    searchParams = {};
  });

  afterEach(async () => {
    await act(async () => {
      await Promise.resolve();
    });
  });

  test("only reads the permission state on launch and never prompts", async () => {
    const root = await renderProvider();
    await flushEffects();

    expect(refreshCalls).toBe(1);
    expect(foregroundRequestCalls).toBe(0);
    expect(backgroundRequestCalls).toBe(0);
    expect(getRenderedOutput(root)).not.toContain("Allow background location");
  });

  test("shares the permission state it read", async () => {
    refreshResult = createPermissionState({ backgroundStatus: "granted", missing: [] });
    const seen: { readyForSharing: boolean | null } = { readyForSharing: null };
    const Probe = () => {
      seen.readyForSharing = useLocationPermissions().permissionState?.isReadyForSharing ?? null;
      return null;
    };

    await renderProvider(<Probe />);
    await flushEffects();

    expect(seen.readyForSharing).toBe(true);
  });

  test("doesn't check permissions until this phone is set up", async () => {
    thisDeviceState = "registered";
    const root = await renderProvider();
    appStateListener?.("background");
    appStateListener?.("active");
    await flushEffects();

    expect(refreshCalls).toBe(0);

    thisDeviceState = "active";
    await act(async () => {
      root.render(<LocationPermissionProvider>{null}</LocationPermissionProvider>);
      await Promise.resolve();
    });
    await flushEffects();

    expect(refreshCalls).toBe(1);
  });

  test.each([
    ["linking", "/setup/link", {}],
    ["removing old devices", "/setup/remove-devices", {}],
    ["restoring from the phrase during setup", "/account/recovery-restore", { setup: "true" }],
    ["starting fresh during setup", "/account/recovery-reset", { setup: "true" }],
  ])(
    "waits until setup is finished before checking, while %s",
    async (_step, setupPath, params) => {
      pathname = setupPath;
      searchParams = params;
      const root = await renderProvider();
      appStateListener?.("background");
      appStateListener?.("active");
      await flushEffects();

      expect(refreshCalls).toBe(0);

      pathname = "/";
      searchParams = {};
      await act(async () => {
        root.render(<LocationPermissionProvider>{null}</LocationPermissionProvider>);
        await Promise.resolve();
      });
      await flushEffects();

      expect(refreshCalls).toBe(1);
    },
  );

  test("checks again when the app resumes", async () => {
    await renderProvider();
    await flushEffects();

    appStateListener?.("background");
    await flushEffects();
    appStateListener?.("active");
    await flushEffects();

    expect(refreshCalls).toBe(2);
  });

  test("account warning asks for background access in app only after Continue is pressed", async () => {
    const root = await renderProvider(<AccountWarning />);
    await flushEffects();
    await act(async () => {
      pressButton(root, 0);
    });
    expect(getRenderedOutput(root)).toContain("Allow background location");
    expect(getRenderedOutput(root)).toContain("The app will ask for that access next.");
    expect(backgroundRequestCalls).toBe(0);
    await act(async () => {
      pressButton(root, 2);
      await Promise.resolve();
    });
    expect(backgroundRequestCalls).toBe(1);
    expect(settingsCalls).toBe(0);
  });

  test("account warning asks for location in app when it was never asked", async () => {
    refreshResult = createPermissionState({
      foregroundStatus: "undetermined",
      backgroundStatus: "undetermined",
      preciseEnabled: false,
      canRequestBackgroundInApp: false,
      missing: ["foreground"],
    });
    const root = await renderProvider(<AccountWarning />);
    await flushEffects();
    await act(async () => {
      pressButton(root, 0);
    });
    expect(getRenderedOutput(root)).toContain("Allow location access");
    await act(async () => {
      pressButton(root, 2);
      await Promise.resolve();
    });
    expect(foregroundRequestCalls).toBe(1);
    expect(settingsCalls).toBe(0);
  });

  test("account warning offers settings when access cannot be requested again", async () => {
    refreshResult = createPermissionState({ canRequestBackgroundInApp: false });
    const root = await renderProvider(<AccountWarning />);
    await flushEffects();
    await act(async () => {
      pressButton(root, 0);
    });
    expect(getRenderedOutput(root)).toContain("update location access in your device settings");
    await act(async () => {
      pressButton(root, 2);
      await Promise.resolve();
    });
    expect(settingsCalls).toBe(1);
    expect(backgroundRequestCalls).toBe(0);
    expect(foregroundRequestCalls).toBe(0);
  });

  test("Not now closes the dialog without asking", async () => {
    const root = await renderProvider(<AccountWarning />);
    await flushEffects();
    await act(async () => {
      pressButton(root, 0);
    });
    await act(async () => {
      pressButton(root, 1);
      await Promise.resolve();
    });
    expect(getRenderedOutput(root)).not.toContain("Allow background location");
    expect(backgroundRequestCalls).toBe(0);
    expect(settingsCalls).toBe(0);
  });
});
