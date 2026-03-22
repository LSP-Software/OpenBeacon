import { beforeEach, describe, expect, mock, test } from "bun:test";

let configureCalls: Array<{
  webClientId: string;
  iosClientId?: string;
}> = [];
let storedToken: string | null = null;
const deleteItemAsyncMock = mock(async () => {});
const revokeSessionMock = mock(async () => ({
  error: null,
}));

mock.module("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: {
    configure: (options: { webClientId: string; iosClientId?: string }) => {
      configureCalls.push(options);
    },
    hasPlayServices: async () => true,
    signIn: async () => ({
      type: "success",
      data: {
        idToken: "google-id-token",
      },
    }),
  },
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
  getItemAsync: async () => storedToken,
  deleteItemAsync: deleteItemAsyncMock,
}));

mock.module("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: () => ({
      remove: () => {},
    }),
  },
  Platform: {
    OS: "android",
  },
}));

mock.module("./auth-client.ts", () => ({
  SESSION_TOKEN_TO_REVOKE_KEY: "session-token",
  authClient: {
    revokeSession: revokeSessionMock,
    signIn: {
      social: async ({ provider, idToken }: { provider: string; idToken: { token: string } }) => ({
        data: {
          provider,
          token: idToken.token,
        },
      }),
    },
  },
}));

const importAuthModule = async () =>
  import(`./auth.ts?test=${Math.random().toString(36).slice(2)}`) as Promise<
    typeof import("./auth.ts")
  >;

describe("auth Google sign-in configuration", () => {
  beforeEach(() => {
    configureCalls = [];
    storedToken = null;
    deleteItemAsyncMock.mockClear();
    revokeSessionMock.mockClear();
    delete process.env["EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID"];
    delete process.env["EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID"];
    delete process.env["EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME"];
  });

  test("requires iOS client configuration only on iOS", async () => {
    process.env["EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID"] = "web-client-id";

    const { isNativeGoogleSignInConfiguredForPlatform } = await importAuthModule();

    expect(isNativeGoogleSignInConfiguredForPlatform("android")).toBe(true);
    expect(isNativeGoogleSignInConfiguredForPlatform("ios")).toBe(false);

    process.env["EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID"] = "ios-client-id";
    process.env["EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME"] = "com.googleusercontent.apps.test";

    expect(isNativeGoogleSignInConfiguredForPlatform("ios")).toBe(true);
    expect(isNativeGoogleSignInConfiguredForPlatform("web")).toBe(false);
  });

  test("allows Android sign-in with only the web client id configured", async () => {
    process.env["EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID"] = "web-client-id";

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
});
