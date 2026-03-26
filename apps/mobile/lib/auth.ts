import {
  GoogleSignin,
  isCancelledResponse,
  isSuccessResponse,
} from "@react-native-google-signin/google-signin";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "./auth-client.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { tryCatch } from "./tryCatch.ts";

const GOOGLE_WEB_CLIENT_ID_ENV = "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID";
const GOOGLE_IOS_CLIENT_ID_ENV = "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID";
const GOOGLE_IOS_URL_SCHEME_ENV = "EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME";

const getGoogleWebClientId = () => process.env[GOOGLE_WEB_CLIENT_ID_ENV];

const getGoogleIosClientId = () => process.env[GOOGLE_IOS_CLIENT_ID_ENV];

const getGoogleIosUrlScheme = () => process.env[GOOGLE_IOS_URL_SCHEME_ENV];

export const isNativeGoogleSignInConfiguredForPlatform = (platform: typeof Platform.OS) => {
  const googleWebClientId = getGoogleWebClientId();

  if (!googleWebClientId || platform === "web") {
    return false;
  }

  if (platform === "ios") {
    return Boolean(getGoogleIosClientId() && getGoogleIosUrlScheme());
  }

  return true;
};

export const isNativeGoogleSignInConfigured = isNativeGoogleSignInConfiguredForPlatform(
  Platform.OS,
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
  const tokenResult = await tryCatch(SecureStore.getItemAsync(SESSION_TOKEN_TO_REVOKE_KEY));

  if (!tokenResult.data) {
    return;
  }

  const revokeResult = await tryCatch(authClient.revokeSession({ token: tokenResult.data }));
  if (revokeResult.error || revokeResult.data.error) {
    return;
  }

  await tryCatch(SecureStore.deleteItemAsync(SESSION_TOKEN_TO_REVOKE_KEY));
};

export const completeAuthenticatedSessionSetup = async () => {
  await revokePendingSessionToken();

  const { error, data } = await tryCatch(ensureDeviceKeyRegistration());
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

  return signInResult.data;
};
