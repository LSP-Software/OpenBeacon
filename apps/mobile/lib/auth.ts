import { GoogleSignin, isSuccessResponse } from "@react-native-google-signin/google-signin";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { authClient, SESSION_TOKEN_TO_REVOKE_KEY } from "./auth-client.ts";
import { tryCatch } from "./tryCatch.ts";

const env = process.env as {
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?: string;
  EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME?: string;
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?: string;
};

const googleWebClientId = env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const googleIosClientId = env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const googleIosUrlScheme = env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;

export const isNativeGoogleSignInConfigured = Boolean(
  Platform.OS !== "web" && googleWebClientId && googleIosClientId && googleIosUrlScheme,
);

let googleSignInConfigured = false;

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to sign in with Google.";
};

const configureGoogleSignIn = () => {
  if (
    googleSignInConfigured ||
    !googleWebClientId ||
    !googleIosClientId ||
    !isNativeGoogleSignInConfigured
  ) {
    return;
  }

  GoogleSignin.configure({
    webClientId: googleWebClientId,
    iosClientId: googleIosClientId,
  });

  googleSignInConfigured = true;
};

export const revokePendingSessionToken = async () => {
  const tokenResult = await tryCatch(SecureStore.getItemAsync(SESSION_TOKEN_TO_REVOKE_KEY));

  if (!tokenResult.data) {
    return;
  }

  const revokeResult = await authClient.revokeSession({ token: tokenResult.data });
  if (revokeResult.error) {
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
