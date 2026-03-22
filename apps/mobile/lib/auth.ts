import { GoogleSignin, isSuccessResponse } from "@react-native-google-signin/google-signin";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "./auth-client.ts";
import { tryCatch } from "./tryCatch.ts";

const getGoogleWebClientId = () => process.env["EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID"];

const getGoogleIosClientId = () => process.env["EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID"];

const getGoogleIosUrlScheme = () => process.env["EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME"];

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

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to sign in with Google.";
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
          message: getErrorMessage(playServicesResult.error),
        },
      };
    }
  }

  const googleSignInResult = await tryCatch(GoogleSignin.signIn());
  if (googleSignInResult.error) {
    return {
      error: {
        message: getErrorMessage(googleSignInResult.error),
      },
    };
  }

  if (!isSuccessResponse(googleSignInResult.data) || !googleSignInResult.data.data.idToken) {
    return {
      error: {
        message: "Google sign in did not return an ID token.",
      },
    };
  }

  return authClient.signIn.social({
    provider: "google",
    idToken: {
      token: googleSignInResult.data.data.idToken,
    },
  });
};
