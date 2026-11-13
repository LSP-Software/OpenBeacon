import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HANDOVER_REJECTED_MESSAGE = "handover rejected";
const notFound = () =>
  TRPCClientError.from({
    error: {
      code: -32004,
      data: { code: "NOT_FOUND", reason: "CODE_EXPIRED" },
      message: "NOT_FOUND",
    },
  });
const approvedStatus = {
  approverPublicKey: "approver-public-key",
  ciphertext: "ciphertext",
  enc: "enc",
  state: "approved" as const,
};

let statusData: { state: string } | undefined;
let goneLinkId: string | null = null;
let statusError: Error | null = null;
const backHandlers = new Set<() => boolean>();
let deviceActive = false;
let activeCheck: () => Promise<boolean> = async () => deviceActive;
let canGoBack = false;
let gestureEnabled: boolean | undefined;
const secureStoreValues = new Map<string, string>();
const shownCodes: { linkId: string; psk: Uint8Array }[] = [];
let queryOptions: {
  enabled?: boolean;
  linkId?: string;
  refetchInterval?: (query: { state: { data: { state: string } | undefined } }) => number | false;
} = {};
const replace = mock((_route: string) => {});
const createLink = mock(async (): Promise<{ linkId: string }> => ({
  linkId: `link-${createLink.mock.calls.length}`,
}));
const finishDeviceLink = mock(
  async (_input: { linkId: string; psk: Uint8Array }): Promise<{ userId: string }> => ({
    userId: "user-1",
  }),
);

const ensureDeviceKeyRegistration = mock(async () => ({
  deviceId: "device-new",
  publicKey: "device-public-key",
  userId: "user-1",
}));

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("expo-router", () => ({
  Link: ({ children, href }: { children: React.ReactElement; href: string }) =>
    React.cloneElement(children as React.ReactElement<{ onPress?: () => void }>, {
      onPress: () => replace(href),
    }),
  router: { back: () => {}, canGoBack: () => canGoBack, replace },
  Stack: {
    Screen: ({ options }: { options: { gestureEnabled?: boolean } }) => {
      gestureEnabled = options.gestureEnabled;
      return null;
    },
  },
  useFocusEffect: (effect: () => () => void) => React.useEffect(effect, [effect]),
}));
mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({ isPending: false, mutateAsync: createLink }),
  useQuery: (options: typeof queryOptions) => {
    queryOptions = options;
    const error = goneLinkId !== null && options.linkId === goneLinkId ? notFound() : statusError;
    return { data: error ? undefined : statusData, error, isError: error !== null };
  },
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
mock.module("@openbeacon/encryption", () => ({
  createDeviceLinkSecret: () => globalThis.crypto.getRandomValues(new Uint8Array(32)),
  decodeBase64: (value: string) => new Uint8Array(Buffer.from(value, "base64")),
  encodeBase64: (value: Uint8Array) => Buffer.from(value).toString("base64"),
  formatDeviceLinkCode: (code: { linkId: string; psk: Uint8Array }) => {
    shownCodes.push(code);
    return "device-link-code";
  },
}));
mock.module("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  deleteItemAsync: async (key: string) => {
    secureStoreValues.delete(key);
  },
  getItemAsync: async (key: string) => secureStoreValues.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secureStoreValues.set(key, value);
  },
}));
mock.module("expo-screen-capture", () => ({
  allowScreenCaptureAsync: async () => {},
  disableAppSwitcherProtectionAsync: async () => {},
  enableAppSwitcherProtectionAsync: async () => {},
  preventScreenCaptureAsync: async () => {},
}));
mock.module("react-native", () => ({
  BackHandler: {
    addEventListener: (_event: string, handler: () => boolean) => {
      backHandlers.add(handler);
      return { remove: () => backHandlers.delete(handler) };
    },
  },
  Pressable: View,
  ScrollView: View,
  View,
}));
mock.module("lucide-react-native", () => ({ ArrowLeftIcon: () => null }));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/BrandedQrCode.tsx", () => ({ BrandedQrCode: () => null }));
mock.module("expo-device", () => ({ DeviceType: { PHONE: 1, TABLET: 2 }, deviceType: 1 }));
mock.module("../lib/pendingJoinCode.ts", () => ({
  openAppAfterSetup: (home: string) => replace(home),
}));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../lib/api.ts", () => ({
  trpc: {
    deviceLink: {
      create: { mutationOptions: () => ({}) },
      status: { queryOptions: (input: { linkId: string }) => input },
    },
  },
}));
mock.module("../lib/deviceKeys.ts", () => ({ ensureDeviceKeyRegistration }));
mock.module("../lib/deviceActivation.ts", () => ({
  isThisDeviceActive: () => activeCheck(),
}));
mock.module("../lib/createHistoryKey.ts", () => ({
  KEY_NOT_SAVED_MESSAGE: "Unable to save your keys on this phone.",
}));
mock.module("../lib/deviceLink.ts", () => ({ finishDeviceLink, HANDOVER_REJECTED_MESSAGE }));
mock.module("../lib/resealPersonalData.ts", () => ({ resealPersonalData: async () => {} }));
mock.module("../lib/trackingEvents.ts", () => ({ requestTrackingSync: () => {} }));

const { default: LinkWithOtherPhoneScreen } = await import("../app/setup/link.tsx");

let root: Root | null = null;

const render = async () => {
  root ??= createRoot();
  await act(async () => root?.render(<LinkWithOtherPhoneScreen />));
};

const rendered = () => JSON.stringify(root?.container.toJSON());

const pressButton = async (label: string) => {
  const button = root?.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes(label));
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => (button.props as { onPress: () => void }).onPress());
};

const relaunch = async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  await render();
};

beforeEach(() => {
  statusData = undefined;
  goneLinkId = null;
  statusError = null;
  deviceActive = false;
  activeCheck = async () => deviceActive;
  canGoBack = false;
  gestureEnabled = undefined;
  secureStoreValues.clear();
  shownCodes.length = 0;
  replace.mockClear();
  createLink.mockClear();
  finishDeviceLink.mockClear();
  ensureDeviceKeyRegistration.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

test("keeps polling every 2 seconds, even after a failed poll, until approved or expired", async () => {
  await render();
  const interval = (data: { state: string } | undefined) =>
    queryOptions.refetchInterval?.({ state: { data } });
  expect(interval(undefined)).toBe(2_000);
  expect(interval({ state: "waiting" })).toBe(2_000);
  expect(interval({ state: "approved" })).toBe(false);
  expect(interval({ state: "expired" })).toBe(false);
});

test("a network error after approval offers Try again with the same handover", async () => {
  finishDeviceLink.mockImplementationOnce(async () => {
    throw new TRPCClientError("Network request failed");
  });
  await render();
  statusData = approvedStatus;
  await render();

  expect(rendered()).toContain("We couldn’t reach the server");
  expect(rendered()).toContain("Try again");
  expect(rendered()).not.toContain("Continue");
  expect(queryOptions.enabled).toBe(false);

  await pressButton("Try again");

  expect(finishDeviceLink).toHaveBeenCalledTimes(2);
  const [first, second] = finishDeviceLink.mock.calls.map(([input]) => input);
  expect(second).toEqual(first);
  expect(first).toMatchObject({ linkId: "link-1", ciphertext: "ciphertext" });
  expect(createLink).toHaveBeenCalledTimes(1);
  expect(replace.mock.calls).toEqual([["/setup/name"]]);
});

test("a rejected handover only offers Continue once the server confirms this phone is set up", async () => {
  finishDeviceLink.mockImplementationOnce(async () => {
    throw new Error(HANDOVER_REJECTED_MESSAGE);
  });
  await render();
  activeCheck = async () => true;
  statusData = approvedStatus;
  await render();

  expect(rendered()).toContain(HANDOVER_REJECTED_MESSAGE);
  expect(rendered()).not.toContain("Try again");
  await pressButton("Continue");
  expect(replace.mock.calls).toEqual([["/setup/name"]]);
});

test("a rejected handover that can't be confirmed offers Try again instead of Continue", async () => {
  finishDeviceLink.mockImplementationOnce(async () => {
    throw new Error(HANDOVER_REJECTED_MESSAGE);
  });
  await render();
  activeCheck = async () => {
    throw new TRPCClientError("Network request failed");
  };
  statusData = approvedStatus;
  await render();

  expect(rendered()).toContain("We couldn’t check that this phone is set up");
  expect(rendered()).not.toContain("Continue");
  expect(replace).not.toHaveBeenCalled();
  canGoBack = true;
  expect(pressHardwareBack()).toBe(false);

  activeCheck = async () => true;
  await pressButton("Try again");

  expect(finishDeviceLink).toHaveBeenCalledTimes(1);
  expect(rendered()).toContain(HANDOVER_REJECTED_MESSAGE);
  await pressButton("Continue");
  expect(replace.mock.calls).toEqual([["/setup/name"]]);
});

test("a rejected handover the server says isn't set up offers Try again", async () => {
  finishDeviceLink.mockImplementationOnce(async () => {
    throw new Error(HANDOVER_REJECTED_MESSAGE);
  });
  await render();
  statusData = approvedStatus;
  await render();

  expect(rendered()).toContain("We couldn’t check that this phone is set up");
  expect(rendered()).not.toContain("Continue");
});

test("a phone that's already set up is told so instead of being told the server is unreachable", async () => {
  createLink.mockImplementationOnce(async () => {
    throw TRPCClientError.from({
      error: {
        code: -32009,
        data: { code: "CONFLICT", reason: "ALREADY_SET_UP" },
        message: "This phone is already set up.",
      },
    });
  });
  await render();

  expect(rendered()).toContain("This phone is already set up.");
  expect(rendered()).not.toContain("couldn’t reach the server");
  await pressButton("Continue");
  expect(replace.mock.calls).toEqual([["/"]]);
});

test("a relaunch after approval picks the saved code up and finishes with the same secret", async () => {
  await render();
  const shown = shownCodes.at(-1);
  expect(shown?.linkId).toBe("link-1");
  expect([...secureStoreValues.keys()]).toEqual(["encryption.deviceLink.user-1.device-new"]);

  statusData = approvedStatus;
  await relaunch();

  expect(createLink).toHaveBeenCalledTimes(1);
  expect(finishDeviceLink).toHaveBeenCalledTimes(1);
  const [input] = finishDeviceLink.mock.calls[0] ?? [];
  expect(input?.linkId).toBe("link-1");
  expect(input?.psk).toEqual(shown?.psk as Uint8Array);
  expect(replace.mock.calls).toEqual([["/setup/name"]]);
});

test("a relaunch while waiting shows the same code again", async () => {
  await render();
  const [first] = shownCodes;
  statusData = { state: "waiting" };
  shownCodes.length = 0;
  await relaunch();

  expect(createLink).toHaveBeenCalledTimes(1);
  expect(shownCodes.at(-1)).toEqual(first as { linkId: string; psk: Uint8Array });
});

test("a new code replaces the saved one", async () => {
  await render();
  const first = secureStoreValues.get("encryption.deviceLink.user-1.device-new");
  statusData = { state: "expired" };
  await render();
  statusData = undefined;
  await pressButton("Show a new code");

  expect(createLink).toHaveBeenCalledTimes(2);
  expect(shownCodes.at(-1)?.linkId).toBe("link-2");
  const saved = secureStoreValues.get("encryption.deviceLink.user-1.device-new");
  expect(saved).toBeDefined();
  expect(saved).not.toBe(first);
  expect(JSON.parse(saved ?? "{}").linkId).toBe("link-2");
});

test("an expired saved code is forgotten and a Pending phone can show a new one", async () => {
  await render();
  expect(secureStoreValues.size).toBe(1);
  statusData = { state: "expired" };
  await relaunch();

  expect(secureStoreValues.size).toBe(0);
  expect(rendered()).toContain("Show a new code");
  expect(replace).not.toHaveBeenCalled();
});

test("a saved code the server no longer has is forgotten and a Pending phone gets a new code", async () => {
  await render();
  goneLinkId = "link-1";
  await relaunch();

  expect(createLink).toHaveBeenCalledTimes(2);
  expect(shownCodes.at(-1)?.linkId).toBe("link-2");
  expect(
    JSON.parse(secureStoreValues.get("encryption.deviceLink.user-1.device-new") ?? "{}"),
  ).toMatchObject({ linkId: "link-2" });
});

test("an active phone whose handover is gone forgets the code and continues", async () => {
  await render();
  deviceActive = true;
  goneLinkId = "link-1";
  await relaunch();

  expect(secureStoreValues.size).toBe(0);
  expect(createLink).toHaveBeenCalledTimes(1);
  expect(replace.mock.calls).toEqual([["/"]]);
});

test("an active phone with a code still waiting forgets it and continues", async () => {
  await render();
  deviceActive = true;
  statusData = { state: "waiting" };
  await relaunch();

  expect(secureStoreValues.size).toBe(0);
  expect(replace.mock.calls).toEqual([["/"]]);
});

test("a code that couldn't be saved isn't shown", async () => {
  const setItem = secureStoreValues.set.bind(secureStoreValues);
  secureStoreValues.set = () => {
    throw new Error("Keychain locked");
  };
  await render();
  secureStoreValues.set = setItem;

  expect(shownCodes).toEqual([]);
  expect(rendered()).toContain("Unable to save your keys on this phone.");
  await pressButton("Try again");
  expect(shownCodes.at(-1)?.linkId).toBe("link-2");
});

const pressHardwareBack = () => [...backHandlers].some((handler) => handler());

test("back is blocked only while the handover is being finished", async () => {
  let fail = () => {};
  finishDeviceLink.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = () => reject(new TRPCClientError("Network request failed"));
      }),
  );
  canGoBack = true;
  await render();
  expect(pressHardwareBack()).toBe(false);
  expect(gestureEnabled).toBe(true);

  statusData = approvedStatus;
  await render();
  expect(pressHardwareBack()).toBe(true);
  expect(gestureEnabled).toBe(false);

  await act(async () => fail());
  expect(rendered()).toContain("We couldn’t reach the server");
  expect(pressHardwareBack()).toBe(false);
  expect(gestureEnabled).toBe(true);
  expect(replace).not.toHaveBeenCalled();
});

test("hardware back goes to the setup options when there's nothing to go back to", async () => {
  await render();

  expect(pressHardwareBack()).toBe(true);
  expect(replace.mock.calls).toEqual([["/setup"]]);
});

test("an active phone resuming a saved code doesn't show it while checking it", async () => {
  await render();
  deviceActive = true;
  shownCodes.length = 0;
  await relaunch();

  expect(shownCodes).toEqual([]);
  expect(rendered()).not.toContain("Waiting for your other phone");
});

test("an active phone that can't reach the server can carry on to the map", async () => {
  await render();
  deviceActive = true;
  statusError = new TRPCClientError("Network request failed");
  shownCodes.length = 0;
  await relaunch();

  expect(shownCodes).toEqual([]);
  expect(secureStoreValues.size).toBe(1);
  await pressButton("Continue to the map");
  expect(replace.mock.calls).toEqual([["/(tabs)/map"]]);
});

test("a Pending phone that can't reach the server keeps showing its saved code", async () => {
  await render();
  statusError = new TRPCClientError("Network request failed");
  shownCodes.length = 0;
  await relaunch();

  expect(shownCodes.at(-1)?.linkId).toBe("link-1");
  expect(rendered()).toContain("We can’t reach the server right now. We’ll keep trying.");
});

test("no other signed-in phone shows the server's reason and goes back to the setup options", async () => {
  const message = "None of your other phones are signed in.";
  createLink.mockImplementationOnce(async () => {
    throw TRPCClientError.from({
      error: {
        code: -32012,
        data: { code: "PRECONDITION_FAILED", reason: "NO_APPROVING_DEVICE" },
        message,
      },
    });
  });
  await render();

  expect(rendered()).toContain(message);
  expect(rendered()).not.toContain("couldn’t reach the server");
  expect(rendered()).not.toContain("Try again");
  await pressButton("See other ways to set up");
  expect(replace.mock.calls).toEqual([["/setup"]]);
});

test("a server failure to create a code doesn't show the server's raw error", async () => {
  createLink.mockImplementationOnce(async () => {
    throw TRPCClientError.from({
      error: { code: -32603, data: { code: "INTERNAL_SERVER_ERROR" }, message: "Server broke" },
    });
  });
  await render();

  expect(rendered()).not.toContain("Server broke");
  expect(rendered()).toContain("Something went wrong on the server. Try again.");
  await pressButton("Try again");
  expect(shownCodes.at(-1)?.linkId).toBe("link-2");
});

test("a failure to create a code shows the server's reason when it's one we expect", async () => {
  createLink.mockImplementationOnce(async () => {
    throw TRPCClientError.from({
      error: {
        code: -32029,
        data: { code: "TOO_MANY_REQUESTS" },
        message: "Too many requests. Please try again later.",
      },
    });
  });
  await render();

  expect(rendered()).toContain("Too many requests. Please try again later.");
});

test("a failure to create a code with no answer says the server can't be reached", async () => {
  createLink.mockImplementationOnce(async () => {
    throw new TRPCClientError("Network request failed");
  });
  await render();

  expect(rendered()).toContain("We couldn’t reach the server");
});

test("a refused registration shows a server problem instead of saying the server can't be reached", async () => {
  ensureDeviceKeyRegistration.mockImplementationOnce(async () => {
    throw TRPCClientError.from({
      error: { code: -32001, data: { code: "UNAUTHORIZED" }, message: "UNAUTHORIZED" },
    });
  });
  await render();

  expect(rendered()).not.toContain("couldn’t reach the server");
  expect(rendered()).toContain("Something went wrong on the server. Try again.");
});

test("a registration with no answer says the server can't be reached", async () => {
  ensureDeviceKeyRegistration.mockImplementationOnce(async () => {
    throw new TRPCClientError("Network request failed");
  });
  await render();

  expect(rendered()).toContain("We couldn’t reach the server");
  await pressButton("Try again");
  expect(shownCodes.at(-1)?.linkId).toBe("link-1");
});

test("a Pending phone whose status check is refused shows the reason, not that the server is unreachable", async () => {
  await render();
  statusError = TRPCClientError.from({
    error: { code: -32029, data: { code: "TOO_MANY_REQUESTS" }, message: "Slow down." },
  });
  await relaunch();

  expect(rendered()).toContain("Slow down.");
  expect(rendered()).not.toContain("can’t reach the server");
});
