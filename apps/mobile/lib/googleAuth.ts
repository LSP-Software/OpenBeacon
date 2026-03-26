import { revokePendingSessionToken, signInWithGoogle } from "./auth.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";

export const performGoogleAuth = async ({
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

  if (result.error) {
    alert(failureTitle, result.error.message ?? "Unable to sign in with Google.");
    setLoading(false);
    return;
  }

  await revokePendingSessionToken();
  await ensureDeviceKeyRegistration();
  await onSuccess();
};
