import { beforeEach, describe, expect, mock, test } from "bun:test";
import { deviceRemovedCause } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

const GOOGLE_WEB_CLIENT_ID_ENV = "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID";
const GOOGLE_IOS_CLIENT_ID_ENV = "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID";
const GOOGLE_IOS_URL_SCHEME_ENV = "EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME";

let configureCalls: Array<{
  webClientId: string;
  iosClientId?: string;
}> = [];
let storedToken: string | null = null;
let googleSignInResponse:
  | {
      type: "success";
      data: {
        idToken?: string;
      };
    }
  | {
      type: "cancelled";
      data: null;
    } = {
  type: "success",
  data: {
    idToken: "google-id-token",
  },
};
const socialSignInMock = mock(
  async ({
    provider,
    idToken,
  }: {
    provider: string;
    idToken: { token: string };
  }): Promise<{
    data: { provider: string; token: string } | null;
    error?: { code: string; message: string; status: number };
  }> => ({
    data: {
      provider,
      token: idToken.token,
    },
  }),
);
const ensureDeviceKeyRegistrationMock = mock(async (_input?: { linkSession?: boolean }) => ({
  algorithm: "x25519-xsalsa20-poly1305",
  deviceId: "device-a",
  privateKey: {
    expose: () => new Uint8Array([]),
  },
  publicKey: "public-key",
}));
const deleteItemAsyncMock = mock(async () => {});
const setItemAsyncMock = mock(async () => {});
const revokeSessionMock = mock(async () => ({
  error: null,
}));

mock.module("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: {
    configure: (options: { webClientId: string; iosClientId?: string }) => {
      configureCalls.push(options);
    },
    hasPlayServices: async () => true,
    signIn: async () => googleSignInResponse,
  },
  isCancelledResponse: (
    response: unknown,
  ): response is {
    type: "cancelled";
    data: null;
  } =>
    typeof response === "object" &&
    response !== null &&
    "type" in response &&
    response.type === "cancelled",
  isSuccessResponse: (
    response: unknown,
  ): response is {
    type: "success";
    data: {
      idToken?: string;
    };
  } =>
    typeof response === "object" &&
    response !== null &&
    "type" in response &&
    response.type === "success",
}));

mock.module("expo-secure-store", () => ({
  setItemAsync: setItemAsyncMock,
  getItemAsync: async () => storedToken,
  deleteItemAsync: deleteItemAsyncMock,
}));

mock.module("react-native", () => createReactNativeTestModule({ platformOS: "android" }));

mock.module("./auth-client.ts", () => ({
  readSessionTokenToRevoke: async () => storedToken,
  forgetSessionTokenToRevoke: deleteItemAsyncMock,
  authClient: {
    revokeSession: revokeSessionMock,
    signIn: {
      social: socialSignInMock,
    },
  },
}));

mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: ensureDeviceKeyRegistrationMock,
}));

const resetSessionLinkRetriesMock = mock(() => {});
mock.module("./sessionLink.ts", () => ({
  resetSessionLinkRetries: resetSessionLinkRetriesMock,
}));

const importAuthModule = async () =>
  import(`./auth.ts?test=${Math.random().toString(36).slice(2)}`) as Promise<
    typeof import("./auth.ts")
  >;

describe("auth Google sign-in configuration", () => {
  beforeEach(() => {
    configureCalls = [];
    storedToken = null;
    googleSignInResponse = {
      type: "success",
      data: {
        idToken: "google-id-token",
      },
    };
    socialSignInMock.mockClear();
    ensureDeviceKeyRegistrationMock.mockClear();
    deleteItemAsyncMock.mockClear();
    setItemAsyncMock.mockClear();
    revokeSessionMock.mockClear();
    resetSessionLinkRetriesMock.mockClear();
    delete process.env[GOOGLE_WEB_CLIENT_ID_ENV];
    delete process.env[GOOGLE_IOS_CLIENT_ID_ENV];
    delete process.env[GOOGLE_IOS_URL_SCHEME_ENV];
  });

  test("requires iOS client configuration only on iOS", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";

    const { isNativeGoogleSignInConfiguredForPlatform } = await importAuthModule();

    expect(isNativeGoogleSignInConfiguredForPlatform("android")).toBe(true);
    expect(isNativeGoogleSignInConfiguredForPlatform("ios")).toBe(false);

    process.env[GOOGLE_IOS_CLIENT_ID_ENV] = "ios-client-id";
    process.env[GOOGLE_IOS_URL_SCHEME_ENV] = "com.googleusercontent.apps.test";

    expect(isNativeGoogleSignInConfiguredForPlatform("ios")).toBe(true);
  });

  test("allows Android sign-in with only the web client id configured", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";

    const { isNativeGoogleSignInConfigured, signInWithGoogle } = await importAuthModule();

    expect(isNativeGoogleSignInConfigured).toBe(true);

    const result = await signInWithGoogle();

    expect("error" in result ? result.error : null).toBeNull();
    expect(configureCalls).toEqual([
      {
        webClientId: "web-client-id",
      },
    ]);
  });

  test("returns silently when Google sign-in is cancelled", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    googleSignInResponse = {
      type: "cancelled",
      data: null,
    };

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({});
    expect(socialSignInMock).not.toHaveBeenCalled();
  });

  test("normalizes thrown social sign-in errors", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    socialSignInMock.mockImplementationOnce(async () => {
      throw new Error("oauth failed");
    });

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({
      error: {
        message: "oauth failed",
      },
    });
  });

  test("explains that an email which signs in with a password can't use Google", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    socialSignInMock.mockImplementationOnce(async () => ({
      data: null,
      error: { code: "OAUTH_LINK_ERROR", message: "account not linked", status: 401 },
    }));

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({
      error: { message: "This email signs in with a password." },
    });
  });

  test("does not delete the pending token when revokeSession throws", async () => {
    storedToken = "pending-session-token";
    revokeSessionMock.mockImplementationOnce(async () => {
      throw new Error("network failed");
    });

    const { revokePendingSessionToken } = await importAuthModule();

    await revokePendingSessionToken();

    expect(revokeSessionMock).toHaveBeenCalledWith({
      token: "pending-session-token",
    });
    expect(deleteItemAsyncMock).not.toHaveBeenCalled();
  });

  test("completes device setup after authentication", async () => {
    const { completeAuthenticatedSessionSetup } = await importAuthModule();

    const result = await completeAuthenticatedSessionSetup();

    expect(result.error).toBeNull();
    expect(ensureDeviceKeyRegistrationMock).toHaveBeenCalledTimes(1);
    expect(ensureDeviceKeyRegistrationMock).toHaveBeenCalledWith({ linkSession: true });
  });

  test("a new sign-in lets the phone retry linking its session again", async () => {
    const { completeAuthenticatedSessionSetup } = await importAuthModule();

    await completeAuthenticatedSessionSetup();

    expect(resetSessionLinkRetriesMock).toHaveBeenCalledTimes(1);
  });

  test("reports a removed phone without an error message", async () => {
    ensureDeviceKeyRegistrationMock.mockImplementationOnce(async () => {
      throw TRPCClientError.from({
        error: {
          code: -32001,
          data: {
            cause: deviceRemovedCause,
            reason: deviceRemovedCause,
            code: "UNAUTHORIZED",
            httpStatus: 401,
          },
          message: "Removed",
        },
      });
    });

    const { completeAuthenticatedSessionSetup } = await importAuthModule();

    await expect(completeAuthenticatedSessionSetup()).resolves.toEqual({
      data: null,
      deviceRemoved: true,
      error: null,
    });
  });

  test("returns a readable error when device setup fails", async () => {
    ensureDeviceKeyRegistrationMock.mockImplementationOnce(async () => {
      throw new Error("device registration failed");
    });

    const { completeAuthenticatedSessionSetup } = await importAuthModule();

    await expect(completeAuthenticatedSessionSetup()).resolves.toEqual({
      data: null,
      error: {
        message: "device registration failed",
      },
    });
  });
});
