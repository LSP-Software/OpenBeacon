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
let launchRequestCalls = 0;
let refreshCalls = 0;
let backgroundRequestCalls = 0;
let settingsCalls = 0;
let notificationRequestCalls = 0;
let permissionRequestOrder: string[] = [];
let notificationGate: Promise<void> | null = null;
let refreshGate: Promise<void> | null = null;
let launchRequestResult: import("../lib/locationPermissions.ts").LocationPermissionState;
let refreshResult: import("../lib/locationPermissions.ts").LocationPermissionState;
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
    await refreshGate;
    return refreshResult;
  },
  openLocationSettings: async () => {
    settingsCalls += 1;
  },
  requestBackgroundLocationPermissions: async () => {
    backgroundRequestCalls += 1;
    return backgroundRequestResult;
  },
  requestLocationPermissionsForLaunch: async () => {
    launchRequestCalls += 1;
    permissionRequestOrder.push("location");
    return launchRequestResult;
  },
}));

mock.module("../lib/notifications.ts", () => ({
  dismissNotice: async () => {},
  requestNotificationPermissions: async () => {
    notificationRequestCalls += 1;
    permissionRequestOrder.push("notification");
    await notificationGate;
    return true;
  },
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
    launchRequestCalls = 0;
    refreshCalls = 0;
    backgroundRequestCalls = 0;
    settingsCalls = 0;
    notificationRequestCalls = 0;
    permissionRequestOrder = [];
    notificationGate = null;
    refreshGate = null;
    launchRequestResult = createPermissionState({});
    refreshResult = createPermissionState({});
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

  test("uses the launch request path on initial signed-in load", async () => {
    await renderProvider();

    expect(launchRequestCalls).toBe(1);
    expect(notificationRequestCalls).toBe(1);
    expect(permissionRequestOrder).toEqual(["notification", "location"]);
    expect(refreshCalls).toBe(0);
  });

  test("doesn't ask for permissions until this phone is set up", async () => {
    thisDeviceState = "registered";
    const root = await renderProvider();
    appStateListener?.("background");
    appStateListener?.("active");
    await flushEffects();

    expect(notificationRequestCalls).toBe(0);
    expect(launchRequestCalls).toBe(0);
    expect(refreshCalls).toBe(0);

    thisDeviceState = "active";
    await act(async () => {
      root.render(<LocationPermissionProvider>{null}</LocationPermissionProvider>);
      await Promise.resolve();
    });
    await flushEffects();

    expect(notificationRequestCalls).toBe(1);
    expect(launchRequestCalls).toBe(1);
  });

  test.each([
    ["linking", "/setup/link", {}],
    ["naming this phone", "/setup/name", {}],
    ["removing old devices", "/setup/remove-devices", {}],
    ["restoring from the phrase during setup", "/account/recovery-restore", { setup: "true" }],
    ["starting fresh during setup", "/account/recovery-reset", { setup: "true" }],
  ])("waits until setup is finished before asking, while %s", async (_step, setupPath, params) => {
    pathname = setupPath;
    searchParams = params;
    const root = await renderProvider();
    appStateListener?.("background");
    appStateListener?.("active");
    await flushEffects();

    expect(notificationRequestCalls).toBe(0);
    expect(launchRequestCalls).toBe(0);
    expect(refreshCalls).toBe(0);

    pathname = "/";
    searchParams = {};
    await act(async () => {
      root.render(<LocationPermissionProvider>{null}</LocationPermissionProvider>);
      await Promise.resolve();
    });
    await flushEffects();

    expect(notificationRequestCalls).toBe(1);
    expect(launchRequestCalls).toBe(1);
  });

  test("asks as usual on the recovery screens outside setup", async () => {
    pathname = "/account/recovery-reset";
    await renderProvider();

    expect(notificationRequestCalls).toBe(1);
    expect(launchRequestCalls).toBe(1);
  });

  test("runs launch setup when the app resumes during the notification prompt", async () => {
    let finishNotification = () => {};
    let finishRefresh = () => {};
    notificationGate = new Promise((resolve) => {
      finishNotification = resolve;
    });
    refreshGate = new Promise((resolve) => {
      finishRefresh = resolve;
    });
    const SetupState = () => {
      const { isConfiguringLocation } = useLocationPermissions();
      return <text>{isConfiguringLocation ? "configuring" : "finished"}</text>;
    };
    const root = await renderProvider(<SetupState />);

    await act(async () => {
      appStateListener?.("background");
      appStateListener?.("active");
      await Promise.resolve();
      finishNotification();
      await Promise.resolve();
    });
    expect(refreshCalls).toBe(1);
    expect(launchRequestCalls).toBe(0);
    expect(getRenderedOutput(root)).toContain("configuring");
    await act(async () => {
      finishRefresh();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(launchRequestCalls).toBe(1);
    expect(getRenderedOutput(root)).toContain("Allow background location");
    await act(async () => root.unmount());
  });

  test("uses the refresh path when the app resumes", async () => {
    await renderProvider();

    appStateListener?.("background");
    await flushEffects();
    appStateListener?.("active");
    await flushEffects();

    expect(launchRequestCalls).toBe(1);
    expect(refreshCalls).toBe(1);
  });

  test("does not reopen the dialog on resume after the user dismisses it", async () => {
    const root = await renderProvider();

    expect(getRenderedOutput(root)).toContain("Allow background location");

    await act(async () => {
      pressButton(root, 0);
      await Promise.resolve();
    });

    expect(getRenderedOutput(root)).not.toContain("Allow background location");

    appStateListener?.("background");
    await flushEffects();
    appStateListener?.("active");
    await flushEffects();

    expect(getRenderedOutput(root)).not.toContain("Allow background location");
  });

  test("opens the launch dialog only when background escalation is allowed in app", async () => {
    launchRequestResult = createPermissionState({
      canRequestBackgroundInApp: true,
    });

    const root = await renderProvider();

    expect(getRenderedOutput(root)).toContain("Allow background location");
  });

  test("does not open the launch dialog for the iOS allow once state", async () => {
    launchRequestResult = createPermissionState({
      canRequestBackgroundInApp: false,
    });

    const root = await renderProvider();

    expect(getRenderedOutput(root)).not.toContain("Allow background location");
  });

  test("account warning opens the styled dialog before requesting background access", async () => {
    const AccountWarning = () => {
      const { openLocationPermissionSettings } = useLocationPermissions();
      return (
        <button type="button" onClick={openLocationPermissionSettings}>
          Grant access
        </button>
      );
    };
    const root = await renderProvider(<AccountWarning />);
    await act(async () => {
      pressButton(root, 1);
    });
    await act(async () => {
      pressButton(root, 0);
    });
    expect(getRenderedOutput(root)).toContain("Allow background location");
    expect(backgroundRequestCalls).toBe(0);
    await act(async () => {
      pressButton(root, 2);
      await Promise.resolve();
    });
    expect(backgroundRequestCalls).toBe(1);
  });

  test("account warning offers settings when background access cannot be requested again", async () => {
    launchRequestResult = createPermissionState({ canRequestBackgroundInApp: false });
    const AccountWarning = () => {
      const { openLocationPermissionSettings } = useLocationPermissions();
      return (
        <button type="button" onClick={openLocationPermissionSettings}>
          Grant access
        </button>
      );
    };
    const root = await renderProvider(<AccountWarning />);
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
  });

  test("requests background access only after the continue button is pressed", async () => {
    const root = await renderProvider();

    expect(backgroundRequestCalls).toBe(0);

    await act(async () => {
      pressButton(root, 1);
      await Promise.resolve();
    });

    expect(backgroundRequestCalls).toBe(1);
  });
});
