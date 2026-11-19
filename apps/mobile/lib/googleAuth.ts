import { completeAuthenticatedSessionSetup, signInWithGoogle } from "./auth.ts";

let googleAuthInFlight = false;

export const performGoogleAuth = async (options: {
  setLoading: (loading: boolean) => void;
  failureTitle: string;
  onSuccess: () => void | Promise<void>;
  alert: (title: string, message: string) => void;
}) => {
  if (googleAuthInFlight) return;
  googleAuthInFlight = true;
  await runGoogleAuth(options).finally(() => {
    googleAuthInFlight = false;
  });
};

const runGoogleAuth = async ({
  setLoading,
  failureTitle,
  onSuccess,
  alert,
}: {
  setLoading: (loading: boolean) => void;
  failureTitle: string;
  onSuccess: () => void | Promise<void>;
  alert: (title: string, message: string) => void;
}) => {
  setLoading(true);

  const result = await signInWithGoogle();

  if ("cancelled" in result) {
    setLoading(false);
    return;
  }

  if (result.error) {
    alert(failureTitle, result.error.message ?? "Unable to sign in with Google.");
    setLoading(false);
    return;
  }

  const sessionSetupResult = await completeAuthenticatedSessionSetup();
  if (sessionSetupResult.deviceRemoved) {
    setLoading(false);
    return;
  }
  if (sessionSetupResult.error) {
    alert(failureTitle, sessionSetupResult.error.message);
    setLoading(false);
    return;
  }

  await onSuccess();
};
