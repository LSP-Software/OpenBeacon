import { type DevicePrivateKeyMaterial, openSessionLinkChallenge } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { queryClient, trpcClient } from "./api.ts";

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
let lastFailure = 0;

const recoverUnverifiedSession = async () => {
  const { getRegisteredDeviceKey } = await import("./deviceKeys.ts");
  const device = await getRegisteredDeviceKey();
  if (!device) return;
  const linked = await tryCatch(linkSessionToDevice(device));
  if (linked.error) {
    lastFailure = Date.now();
    return;
  }
  await queryClient.invalidateQueries();
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
