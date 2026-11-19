import { googleSignInNonce, tryCatch } from "@openbeacon/shared";
import { Platform } from "react-native";
import {
  GoogleOneTapSignIn,
  isCancelledResponse,
  isErrorWithCode,
  isNoSavedCredentialFoundResponse,
  isSuccessResponse,
  statusCodes,
} from "react-native-nitro-google-signin";
import { z } from "zod";
import {
  SERVER_CHANGED_CODE,
  authClient,
  bindToServer,
  forgetSessionTokenToRevoke,
  readSessionTokenToRevoke,
} from "./auth-client.ts";
import { getBaseUrl } from "./currentServer.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { isDeviceRemovedError } from "./deviceRemovedError.ts";
import { withOwnScreen } from "./ownScreen.ts";
import { SERVER_UNREACHABLE_MESSAGE } from "./serverUnreachable.ts";
import { resetSessionLinkRetries } from "./sessionLink.ts";
import { userMessage } from "./userMessage.ts";

const getGoogleWebClientId = () => process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export const isNativeGoogleSignInConfiguredForPlatform = (platform: string) =>
  platform === "android" && Boolean(getGoogleWebClientId());

export const isNativeGoogleSignInConfigured = isNativeGoogleSignInConfiguredForPlatform(
  Platform.OS,
);

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
        message: userMessage(error),
      },
    };
  }

  return {
    data,
    error: null,
  };
};

const GOOGLE_SIGN_IN_FAILED = "Couldn’t sign in with Google. Try again.";

const SERVER_CHANGED_MESSAGE = "The server changed while you were signing in. Try again.";

const googleSignInError = (message: string) => ({ error: { message } });

const googleLibraryError = (error: unknown) => {
  if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) {
    return { cancelled: true as const };
  }
  if (isErrorWithCode(error) && error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
    return googleSignInError(
      "Google sign-in needs Google Play services. Sign in with your email and password instead.",
    );
  }
  return googleSignInError(GOOGLE_SIGN_IN_FAILED);
};

const runGoogleSignIn = async () => {
  const webClientId = getGoogleWebClientId();
  if (!isNativeGoogleSignInConfigured || !webClientId) {
    return googleSignInError("Google sign in is not configured for this app build.");
  }

  const playServicesResult = await tryCatch(
    Promise.resolve().then(() => GoogleOneTapSignIn.checkPlayServices()),
  );
  if (playServicesResult.error) return googleLibraryError(playServicesResult.error);

  const serverUrl = getBaseUrl();
  const challengeResult = await tryCatch(
    authClient.$fetch<{ challenge: string }>("/google-sign-in/challenge", {
      method: "POST",
      ...bindToServer(serverUrl),
    }),
  );
  if (challengeResult.error) return googleSignInError(GOOGLE_SIGN_IN_FAILED);
  const challengeError = z
    .object({ code: z.string().optional(), status: z.number() })
    .safeParse(challengeResult.data.error).data;
  if (challengeError?.code === SERVER_CHANGED_CODE) {
    return googleSignInError(SERVER_CHANGED_MESSAGE);
  }
  if (challengeError?.status === 503) {
    return googleSignInError(SERVER_UNREACHABLE_MESSAGE);
  }
  const parsedChallenge = z
    .object({ challenge: z.string().regex(/^\d{1,15}\.[\w-]{43}\.[\w-]{43}$/) })
    .safeParse(challengeResult.data.data);
  if (!parsedChallenge.success) return googleSignInError(GOOGLE_SIGN_IN_FAILED);
  const { challenge } = parsedChallenge.data;

  const googleSignInResult = await tryCatch(
    Promise.resolve().then(() => {
      GoogleOneTapSignIn.configure({
        webClientId,
        nonce: googleSignInNonce({ serverUrl, challenge }),
      });
      return withOwnScreen(() => GoogleOneTapSignIn.presentExplicitSignIn());
    }),
  );
  if (googleSignInResult.error) return googleLibraryError(googleSignInResult.error);

  const response = googleSignInResult.data;
  if (isCancelledResponse(response)) return { cancelled: true as const };
  if (isNoSavedCredentialFoundResponse(response)) {
    return googleSignInError("Add a Google account in Android settings, then try again.");
  }
  if (!isSuccessResponse(response) || !response.data.idToken) {
    return googleSignInError(GOOGLE_SIGN_IN_FAILED);
  }

  const signInResult = await tryCatch(
    authClient.signIn.social({
      provider: "google",
      idToken: { token: response.data.idToken, nonce: challenge },
      fetchOptions: bindToServer(serverUrl),
    }),
  );
  if (signInResult.error) return googleSignInError(GOOGLE_SIGN_IN_FAILED);
  const { error } = signInResult.data;
  if (error?.code === "OAUTH_LINK_ERROR" || error?.message === "account not linked") {
    return googleSignInError("This email signs in with a password.");
  }
  if (error?.code === SERVER_CHANGED_CODE) {
    return googleSignInError(SERVER_CHANGED_MESSAGE);
  }
  if (error?.code === "INVALID_TOKEN") return googleSignInError(GOOGLE_SIGN_IN_FAILED);

  return signInResult.data;
};

let googleSignInInFlight: ReturnType<typeof runGoogleSignIn> | null = null;

export const signInWithGoogle = () => {
  googleSignInInFlight ??= tryCatch(runGoogleSignIn())
    .then((result) => result.data ?? googleSignInError(GOOGLE_SIGN_IN_FAILED))
    .finally(() => {
      googleSignInInFlight = null;
    });
  return googleSignInInFlight;
};

export const forgetGoogleSignIn = async () => {
  if (!isNativeGoogleSignInConfigured) return;
  await tryCatch(Promise.resolve().then(() => GoogleOneTapSignIn.signOut()));
};
