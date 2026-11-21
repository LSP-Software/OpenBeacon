import { beforeEach, describe, expect, mock, test } from "bun:test";
import { deviceRemovedCause, googleSignInNonce } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import type { OneTapResponse } from "react-native-nitro-google-signin";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

const GOOGLE_WEB_CLIENT_ID_ENV = "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID";
const CHALLENGE = `1763548800000.${"a".repeat(43)}.${"b".repeat(43)}`;

const signedInWithGoogle = {
  type: "success",
  data: {
    user: {
      id: "google-user",
      email: "person@example.com",
      name: null,
      givenName: null,
      familyName: null,
      photo: null,
    },
    scopes: [],
    idToken: "google-id-token",
    serverAuthCode: null,
  },
} satisfies OneTapResponse;

const googleCalls: string[] = [];
let configureCalls: Array<{ webClientId: string; nonce?: string }> = [];
let configureError: Error | null = null;
let storedToken: string | null = null;
const presentExplicitSignInMock = mock(async (): Promise<OneTapResponse> => signedInWithGoogle);
const checkPlayServicesMock = mock((): Promise<void> => Promise.resolve());
const googleSignOutMock = mock((): Promise<void> => Promise.resolve());
const challengeFetchMock = mock(
  async (
    _path: string,
    _options: { method: string; headers: Record<string, string> },
  ): Promise<{
    data: { challenge: string } | null;
    error: { code?: string; message: string; status: number } | null;
  }> => ({ data: { challenge: CHALLENGE }, error: null }),
);
const socialSignInMock = mock(
  async ({
    provider,
    idToken,
  }: {
    provider: string;
    idToken: { token: string; nonce?: string };
    fetchOptions?: { headers: Record<string, string> };
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

class GoogleSignInError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

mock.module("react-native-nitro-google-signin", () => ({
  GoogleOneTapSignIn: {
    configure: (options: { webClientId: string; nonce?: string }) => {
      if (configureError) throw configureError;
      googleCalls.push("configure");
      configureCalls.push(options);
    },
    checkPlayServices: checkPlayServicesMock,
    presentExplicitSignIn: () => {
      googleCalls.push("presentExplicitSignIn");
      return presentExplicitSignInMock();
    },
    signOut: googleSignOutMock,
  },
  isErrorWithCode: (error: unknown) => error instanceof GoogleSignInError,
  isCancelledResponse: (response: OneTapResponse) => response.type === "cancelled",
  isNoSavedCredentialFoundResponse: (response: OneTapResponse) =>
    response.type === "noSavedCredentialFound",
  isSuccessResponse: (response: OneTapResponse) =>
    response.type === "success" && response.data !== null,
  statusCodes: {
    PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
    SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED",
    DEVELOPER_ERROR: "DEVELOPER_ERROR",
  },
}));

mock.module("./currentServer.ts", () => ({
  getBaseUrl: () => "https://beacon.example.com/openbeacon",
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
  SERVER_CHANGED_CODE: "SERVER_CHANGED",
  bindToServer: (server: string) => ({ headers: { "x-openbeacon-bound-server": server } }),
  authClient: {
    $fetch: challengeFetchMock,
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
    configureError = null;
    googleCalls.length = 0;
    storedToken = null;
    presentExplicitSignInMock.mockReset();
    presentExplicitSignInMock.mockImplementation(async () => signedInWithGoogle);
    checkPlayServicesMock.mockReset();
    checkPlayServicesMock.mockImplementation(() => Promise.resolve());
    googleSignOutMock.mockReset();
    googleSignOutMock.mockImplementation(() => Promise.resolve());
    challengeFetchMock.mockClear();
    socialSignInMock.mockClear();
    ensureDeviceKeyRegistrationMock.mockClear();
    deleteItemAsyncMock.mockClear();
    setItemAsyncMock.mockClear();
    revokeSessionMock.mockClear();
    resetSessionLinkRetriesMock.mockClear();
    delete process.env[GOOGLE_WEB_CLIENT_ID_ENV];
  });

  test("offers Google sign-in only when the server's client ID matches this build's", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    const { canOfferGoogleSignIn } = await importAuthModule();

    expect(canOfferGoogleSignIn({ google: true, googleClientId: "web-client-id" })).toBe(true);
    expect(canOfferGoogleSignIn({ google: true, googleClientId: "other-client-id" })).toBe(false);
    expect(canOfferGoogleSignIn({ google: false, googleClientId: null })).toBe(false);
    expect(canOfferGoogleSignIn(undefined)).toBe(false);
  });

  test("offers Google sign-in on an older server that doesn't say its client ID", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    const { canOfferGoogleSignIn } = await importAuthModule();

    expect(canOfferGoogleSignIn({ google: true })).toBe(true);
  });

  test("doesn't offer Google sign-in in a build without a web client ID", async () => {
    const { canOfferGoogleSignIn } = await importAuthModule();

    expect(canOfferGoogleSignIn({ google: true, googleClientId: "web-client-id" })).toBe(false);
  });

  test("offers Google sign-in on Android only, and only with a web client id", async () => {
    const { isNativeGoogleSignInConfiguredForPlatform } = await importAuthModule();

    expect(isNativeGoogleSignInConfiguredForPlatform("android")).toBe(false);

    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";

    expect(isNativeGoogleSignInConfiguredForPlatform("android")).toBe(true);
    expect(isNativeGoogleSignInConfiguredForPlatform("ios")).toBe(false);
  });

  test("binds the Google token to the server's challenge and address", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";

    const { signInWithGoogle } = await importAuthModule();
    const result = await signInWithGoogle();

    expect("error" in result ? result.error : null).toBeNull();
    expect(challengeFetchMock).toHaveBeenCalledWith("/google-sign-in/challenge", {
      method: "POST",
      headers: { "x-openbeacon-bound-server": "https://beacon.example.com/openbeacon" },
    });
    expect(configureCalls).toEqual([
      {
        webClientId: "web-client-id",
        nonce: googleSignInNonce({
          serverUrl: "https://beacon.example.com",
          challenge: CHALLENGE,
        }),
      },
    ]);
    expect(googleCalls).toEqual(["configure", "presentExplicitSignIn"]);
    expect(socialSignInMock).toHaveBeenCalledWith({
      provider: "google",
      idToken: { token: "google-id-token", nonce: CHALLENGE },
      fetchOptions: {
        headers: { "x-openbeacon-bound-server": "https://beacon.example.com/openbeacon" },
      },
    });
  });

  test("a double tap fetches one challenge and opens Google once", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";

    const { signInWithGoogle } = await importAuthModule();
    const [first, second] = await Promise.all([signInWithGoogle(), signInWithGoogle()]);

    expect(second).toBe(first);
    expect(challengeFetchMock).toHaveBeenCalledTimes(1);
    expect(presentExplicitSignInMock).toHaveBeenCalledTimes(1);
    expect(socialSignInMock).toHaveBeenCalledTimes(1);

    await signInWithGoogle();
    expect(challengeFetchMock).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["an old server without the challenge route", { message: "Not Found", status: 404 }],
    ["a server error", { message: "Internal Server Error", status: 500 }],
  ])("doesn't open Google sign-in for %s", async (_name, error) => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    challengeFetchMock.mockImplementationOnce(async () => ({ data: null, error }));

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({
      error: { message: "Couldn’t sign in with Google. Try again." },
    });
    expect(presentExplicitSignInMock).not.toHaveBeenCalled();
    expect(socialSignInMock).not.toHaveBeenCalled();
  });

  test("says the server changed when it changes before the challenge is sent", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    challengeFetchMock.mockImplementationOnce(async () => ({
      data: null,
      error: { code: "SERVER_CHANGED", message: "The server changed. Try again.", status: 409 },
    }));

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({
      error: { message: "The server changed while you were signing in. Try again." },
    });
    expect(presentExplicitSignInMock).not.toHaveBeenCalled();
  });

  test("says the server can't be reached when the challenge request fails to connect", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    challengeFetchMock.mockImplementationOnce(async () => ({
      data: null,
      error: { message: "Can’t reach the server.", status: 503 },
    }));

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({
      error: { message: "Can’t reach the server. Check your connection and try again." },
    });
    expect(presentExplicitSignInMock).not.toHaveBeenCalled();
  });

  test("a thrown challenge request fails without opening Google", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    challengeFetchMock.mockImplementationOnce(async () => {
      throw new TypeError("Network request failed");
    });

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({
      error: { message: "Couldn’t sign in with Google. Try again." },
    });
    expect(presentExplicitSignInMock).not.toHaveBeenCalled();
  });

  test.each([
    ["an empty body", null],
    ["no challenge", {}],
    ["a malformed challenge", { challenge: "challenge-1" }],
    ["a challenge with extra text", { challenge: `${CHALLENGE}\nnext` }],
  ])("rejects a challenge response with %s", async (_name, data) => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    challengeFetchMock.mockImplementationOnce(async () => ({
      data: data as { challenge: string } | null,
      error: null,
    }));

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({
      error: { message: "Couldn’t sign in with Google. Try again." },
    });
    expect(configureCalls).toEqual([]);
  });

  test("reports a cancelled Google sign-in as cancelled", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    presentExplicitSignInMock.mockImplementationOnce(async () => ({
      type: "cancelled",
      data: null,
    }));

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({ cancelled: true });
    expect(socialSignInMock).not.toHaveBeenCalled();
  });

  test("reports a thrown cancellation as cancelled", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    presentExplicitSignInMock.mockImplementationOnce(async () => {
      throw new GoogleSignInError("SIGN_IN_CANCELLED", "Authorization UI cancelled.");
    });

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({ cancelled: true });
  });

  test("asks for a Google account when the phone has none", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    presentExplicitSignInMock.mockImplementationOnce(async () => ({
      type: "noSavedCredentialFound",
      data: null,
    }));

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({
      error: { message: "Add a Google account in Android settings, then try again." },
    });
    expect(socialSignInMock).not.toHaveBeenCalled();
  });

  test("suggests email and password when Google Play services are missing, even if the check throws straight away", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    checkPlayServicesMock.mockImplementationOnce(() => {
      throw new GoogleSignInError("PLAY_SERVICES_NOT_AVAILABLE", "Play services unavailable");
    });

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({
      error: {
        message:
          "Google sign-in needs Google Play services. Sign in with your email and password instead.",
      },
    });
    expect(challengeFetchMock).not.toHaveBeenCalled();
  });

  test.each([
    [
      "a failed sign-in",
      new GoogleSignInError("ONE_TAP_START_FAILED", "Credential Manager failed"),
    ],
    ["an unexpected error", new Error("java.lang.IllegalStateException\n\tat Foo.kt:12")],
    ["a thrown string", "native crash"],
  ])("hides the detail of %s from Google sign-in", async (_name, error) => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    presentExplicitSignInMock.mockImplementationOnce(async () => {
      throw error;
    });

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({
      error: { message: "Couldn’t sign in with Google. Try again." },
    });
    expect(socialSignInMock).not.toHaveBeenCalled();
  });

  test("a Google setup that throws straight away resolves with an error", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    configureError = new GoogleSignInError("ONE_TAP_START_FAILED", "Credential Manager failed");

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({
      error: { message: "Couldn’t sign in with Google. Try again." },
    });
    expect(presentExplicitSignInMock).not.toHaveBeenCalled();
  });

  test.each([
    [
      "while opening Google",
      () => {
        presentExplicitSignInMock.mockImplementationOnce(async () => {
          throw new GoogleSignInError("DEVELOPER_ERROR", "Wrong SHA-1\n\tat Foo.kt:1");
        });
      },
    ],
    [
      "while setting Google up",
      () => {
        configureError = new GoogleSignInError("DEVELOPER_ERROR", "Invalid webClientId");
      },
    ],
  ])(
    "a Google developer error %s quietly hides Google sign-in for the rest of the run",
    async (_name, fail) => {
      process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
      fail();

      const { canOfferGoogleSignIn, signInWithGoogle } = await importAuthModule();
      const providers = { google: true, googleClientId: "web-client-id" };
      expect(canOfferGoogleSignIn(providers)).toBe(true);

      expect(await signInWithGoogle()).toEqual({ unavailable: true });
      expect(socialSignInMock).not.toHaveBeenCalled();
      expect(canOfferGoogleSignIn(providers)).toBe(false);
    },
  );

  test("hides the detail of a thrown social sign-in", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    socialSignInMock.mockImplementationOnce(async () => {
      throw new Error("oauth failed");
    });

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({
      error: { message: "Couldn’t sign in with Google. Try again." },
    });
  });

  test.each([
    [
      "an email which signs in with a password",
      { code: "OAUTH_LINK_ERROR", message: "account not linked", status: 401 },
      "This email signs in with a password.",
    ],
    [
      "a Google token the server refuses",
      { code: "INVALID_TOKEN", message: "Invalid token", status: 401 },
      "Couldn’t sign in with Google. Try again.",
    ],
    [
      "a server change while Google was open",
      { code: "SERVER_CHANGED", message: "The server changed. Try again.", status: 409 },
      "The server changed while you were signing in. Try again.",
    ],
  ])("explains %s", async (_name, error, message) => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    socialSignInMock.mockImplementationOnce(async () => ({ data: null, error }));

    const { signInWithGoogle } = await importAuthModule();

    expect(await signInWithGoogle()).toEqual({ error: { message } });
  });

  test("forgets the Google account on sign-out and ignores a failure, even one thrown straight away", async () => {
    process.env[GOOGLE_WEB_CLIENT_ID_ENV] = "web-client-id";
    googleSignOutMock.mockImplementationOnce(() => {
      throw new GoogleSignInError("SIGN_OUT_FAILED", "Credential Manager failed");
    });

    const { forgetGoogleSignIn } = await importAuthModule();

    await expect(forgetGoogleSignIn()).resolves.toBeUndefined();
    expect(googleSignOutMock).toHaveBeenCalledTimes(1);
  });

  test("doesn't touch Google on sign-out when Google sign-in isn't set up", async () => {
    const { forgetGoogleSignIn } = await importAuthModule();

    await forgetGoogleSignIn();

    expect(googleSignOutMock).not.toHaveBeenCalled();
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
