import { type DevicePrivateKeyMaterial, openSessionLinkChallenge } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import { Alert } from "./alert.ts";
import { queryClient, trpcClient } from "./api.ts";
import { isDeviceRemovedError } from "./deviceRemovedError.ts";

const proveDevice = async ({
  deviceId,
  privateKey,
  userId,
}: {
  deviceId: string;
  privateKey: DevicePrivateKeyMaterial;
  userId: string;
}) => {
  const challenge = await trpcClient.device.sessionChallenge.mutate({ deviceId });
  if (challenge.linked) return;
  const answer = await tryCatch(
    Promise.resolve().then(() =>
      openSessionLinkChallenge({
        deviceId,
        devicePrivateKey: privateKey,
        sealed: challenge.sealed,
        userId,
      }),
    ),
  );
  if (answer.error) throw new Error("This phone couldn't confirm it's yours. Sign in again.");
  await trpcClient.device.linkSession.mutate({ answer: answer.data, deviceId });
};

let pendingLink: Promise<void> | null = null;

export const linkSessionToDevice = (device: Parameters<typeof proveDevice>[0]) => {
  if (pendingLink) return pendingLink;
  const task = proveDevice(device).finally(() => {
    pendingLink = null;
  });
  pendingLink = task;
  return task;
};

let pendingRecovery: Promise<void> | null = null;
let pendingSignOut: Promise<void> | null = null;
let lastFailure = 0;

export const isSessionLinkRefused = (error: unknown) =>
  error instanceof TRPCClientError &&
  !!error.data &&
  error.data.httpStatus < 500 &&
  error.data.code !== "TOO_MANY_REQUESTS" &&
  !isDeviceRemovedError(error);

export const signOutAfterRefusedSessionLink = () => {
  pendingSignOut ??= (async () => {
    const [{ authClient }, { signOutOfThisPhone }, { router }] = await Promise.all([
      import("./auth-client.ts"),
      import("./signOut.ts"),
      import("expo-router"),
    ]);
    const session = await tryCatch(authClient.getSession());
    await tryCatch(
      signOutOfThisPhone({
        onSigningOut: () => {},
        removeThisPhone: false,
        sessionTokenToRevoke: session.data?.data?.session.token ?? null,
      }),
    );
    await tryCatch(Promise.resolve().then(() => router.replace("/")));
    Alert.alert("You’ve been signed out", "Sign in again to keep using this phone.");
  })().finally(() => {
    pendingSignOut = null;
  });
  return pendingSignOut;
};

const recoverUnverifiedSession = async () => {
  const { getRegisteredDeviceKey } = await import("./deviceKeys.ts");
  const device = await getRegisteredDeviceKey();
  if (!device) return;
  const linked = await tryCatch(linkSessionToDevice(device));
  if (!linked.error) {
    await queryClient.invalidateQueries();
    return;
  }
  lastFailure = Date.now();
  if (isSessionLinkRefused(linked.error)) await signOutAfterRefusedSessionLink();
};

export const handleDeviceUnverified = () => {
  if (pendingRecovery) return pendingRecovery;
  if (Date.now() - lastFailure < 10_000) return Promise.resolve();
  const task = recoverUnverifiedSession().finally(() => {
    pendingRecovery = null;
  });
  pendingRecovery = task;
  return task;
};
