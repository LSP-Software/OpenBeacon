import { tryCatch } from "@openbeacon/shared";
import {
  GoogleSignin,
  isCancelledResponse,
  isSuccessResponse,
} from "@react-native-google-signin/google-signin";
import { Platform } from "react-native";
import { authClient, forgetSessionTokenToRevoke, readSessionTokenToRevoke } from "./auth-client.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { isDeviceRemovedError } from "./deviceRemovedError.ts";
import { resetSessionLinkRetries } from "./sessionLink.ts";

const GOOGLE_WEB_CLIENT_ID_ENV = "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID";
const GOOGLE_IOS_CLIENT_ID_ENV = "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID";
const GOOGLE_IOS_URL_SCHEME_ENV = "EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME";

const getGoogleWebClientId = () => process.env[GOOGLE_WEB_CLIENT_ID_ENV];

const getGoogleIosClientId = () => process.env[GOOGLE_IOS_CLIENT_ID_ENV];

const getGoogleIosUrlScheme = () => process.env[GOOGLE_IOS_URL_SCHEME_ENV];

export const isNativeGoogleSignInConfiguredForPlatform = (platform: "android" | "ios") => {
  const googleWebClientId = getGoogleWebClientId();

  if (!googleWebClientId) {
    return false;
  }

  if (platform === "ios") {
    return Boolean(getGoogleIosClientId() && getGoogleIosUrlScheme());
  }

  return true;
};

export const isNativeGoogleSignInConfigured = isNativeGoogleSignInConfiguredForPlatform(
  Platform.OS === "ios" ? "ios" : "android",
);

let googleSignInConfigured = false;

const getErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
};

const configureGoogleSignIn = () => {
  const googleWebClientId = getGoogleWebClientId();

  if (googleSignInConfigured || !googleWebClientId || !isNativeGoogleSignInConfigured) {
    return;
  }

  if (Platform.OS === "ios") {
    const googleIosClientId = getGoogleIosClientId();

    if (!googleIosClientId) {
      return;
    }

    GoogleSignin.configure({
      webClientId: googleWebClientId,
      iosClientId: googleIosClientId,
    });
  } else {
    GoogleSignin.configure({
      webClientId: googleWebClientId,
    });
  }

  googleSignInConfigured = true;
};

export const revokePendingSessionToken = async () => {
  const token = await tryCatch(readSessionTokenToRevoke());
  if (!token.data) return;

  const revokeResult = await tryCatch(authClient.revokeSession({ token: token.data }));
  if (revokeResult.error || revokeResult.data.error) {
    return;
  }

  await tryCatch(forgetSessionTokenToRevoke());
};

export const completeAuthenticatedSessionSetup = async () => {
  await revokePendingSessionToken();
  resetSessionLinkRetries();

  const { error, data } = await tryCatch(ensureDeviceKeyRegistration({ linkSession: true }));
  if (isDeviceRemovedError(error)) {
    return { data: null, deviceRemoved: true as const, error: null };
  }
  if (error) {
    return {
      data: null,
      error: {
        message: getErrorMessage(error, "Unable to register this device."),
      },
    };
  }

  return {
    data,
    error: null,
  };
};

export const signInWithGoogle = async () => {
  if (!isNativeGoogleSignInConfigured) {
    return {
      error: {
        message: "Google sign in is not configured for this app build.",
      },
    };
  }

  configureGoogleSignIn();

  if (Platform.OS === "android") {
    const playServicesResult = await tryCatch(GoogleSignin.hasPlayServices());
    if (playServicesResult.error) {
      return {
        error: {
          message: getErrorMessage(playServicesResult.error, "Unable to sign in with Google."),
        },
      };
    }
  }

  const googleSignInResult = await tryCatch(GoogleSignin.signIn());
  if (googleSignInResult.error) {
    return {
      error: {
        message: getErrorMessage(googleSignInResult.error, "Unable to sign in with Google."),
      },
    };
  }

  if (isCancelledResponse(googleSignInResult.data)) {
    return {};
  }

  if (!isSuccessResponse(googleSignInResult.data)) {
    return {
      error: {
        message: "Google sign in did not return an ID token.",
      },
    };
  }

  if (!googleSignInResult.data.data.idToken) {
    return {
      error: {
        message: "Google sign in did not return an ID token.",
      },
    };
  }

  const signInResult = await tryCatch(
    authClient.signIn.social({
      provider: "google",
      idToken: {
        token: googleSignInResult.data.data.idToken,
      },
    }),
  );
  if (signInResult.error) {
    return {
      error: {
        message: String(
          signInResult.error instanceof Error ? signInResult.error.message : signInResult.error,
        ),
      },
    };
  }
  if (
    signInResult.data.error?.code === "OAUTH_LINK_ERROR" ||
    signInResult.data.error?.message === "account not linked"
  ) {
    return { error: { message: "This email signs in with a password." } };
  }

  return signInResult.data;
};
