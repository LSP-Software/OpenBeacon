import {
  getHistoryPublicKey,
  openDeviceLinkHandover,
  parseDeviceLinkCode,
  sealDeviceLinkHandover,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { trpcClient } from "./api.ts";
import { KEY_NOT_SAVED_MESSAGE } from "./createHistoryKey.ts";
import { markThisDeviceActive } from "./deviceActivation.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { getStoredHistoryKey, storeHistoryKey } from "./historyKeys.ts";
import { deleteSavedDeviceLink } from "./savedDeviceLink.ts";
import { secretOwner } from "./secretStorage.ts";

export const NOT_A_DEVICE_CODE_MESSAGE =
  "That isn’t an OpenBeacon setup code. On your new phone, choose “Link with your other phone”.";
export const DEVICE_KEY_MISMATCH_MESSAGE =
  "This code doesn’t match the phone that made it, so nothing was shared. Show a fresh code on your new phone and try again.";
export const APPROVER_MISSING_HISTORY_KEY_MESSAGE =
  "This phone doesn’t have your account’s current history key, so it can’t set up another phone. Use your recovery phrase on the new phone instead.";
export const HANDOVER_REJECTED_MESSAGE =
  "This phone is set up, but your other phone’s reply couldn’t be checked, so it can’t read location history yet. To read it, restore your recovery phrase in Account → Recovery phrase.";

export const lookUpDeviceLink = async (code: string) => {
  const parsed = parseDeviceLinkCode(code);
  if (!parsed) throw new Error(NOT_A_DEVICE_CODE_MESSAGE);
  const device = await trpcClient.deviceLink.get.query({ linkId: parsed.linkId });
  if (device.publicKey !== parsed.devicePublicKey) throw new Error(DEVICE_KEY_MISMATCH_MESSAGE);
  return { ...parsed, device };
};

export const approveDeviceLink = async ({
  device,
  linkId,
  psk,
}: Awaited<ReturnType<typeof lookUpDeviceLink>>) => {
  const approver = await ensureDeviceKeyRegistration();
  const status = await trpcClient.accountRecovery.status.query();
  const historyKeys = (
    await Promise.all(
      status.historyKeys.map(async ({ publicKey, version }) => {
        const privateKey = await getStoredHistoryKey({ userId: approver.userId, version });
        return privateKey && getHistoryPublicKey(privateKey) === publicKey
          ? [{ privateKey, version }]
          : [];
      }),
    )
  ).flat();
  const currentVersion = status.currentHistoryKey?.version;
  if (!historyKeys.some(({ version }) => version === currentVersion)) {
    throw new Error(APPROVER_MISSING_HISTORY_KEY_MESSAGE);
  }
  const sealed = sealDeviceLinkHandover({
    approverPrivateKey: approver.privateKey,
    historyKeys,
    linkId,
    newDeviceId: device.deviceId,
    newDevicePublicKey: device.publicKey,
    psk,
    userId: approver.userId,
  });
  await trpcClient.deviceLink.approve.mutate({ linkId, ...sealed });
};

export const finishDeviceLink = async ({
  approverPublicKey,
  ciphertext,
  enc,
  linkId,
  psk,
}: {
  approverPublicKey: string;
  ciphertext: string;
  enc: string;
  linkId: string;
  psk: Uint8Array;
}) => {
  const device = await ensureDeviceKeyRegistration();
  const owner = secretOwner(device.userId);
  const status = await trpcClient.accountRecovery.status.query();
  const reject = async () => {
    await tryCatch(deleteSavedDeviceLink(device));
    return new Error(HANDOVER_REJECTED_MESSAGE);
  };
  const currentHistoryKeyVersion = status.currentHistoryKey?.version;
  if (currentHistoryKeyVersion === undefined) throw await reject();
  const opened = await tryCatch(
    Promise.resolve().then(() =>
      openDeviceLinkHandover({
        approverPublicKey,
        currentHistoryKeyVersion,
        devicePrivateKey: device.privateKey,
        linkId,
        newDeviceId: device.deviceId,
        psk,
        publishedHistoryKeys: status.historyKeys,
        sealed: { ciphertext, enc },
        userId: device.userId,
      }),
    ),
  );
  if (opened.error) throw await reject();
  const stored = await tryCatch(
    Promise.all(
      opened.data.map(({ privateKey, version }) =>
        storeHistoryKey({ privateKey, owner, userId: device.userId, version }),
      ),
    ),
  );
  if (stored.error) throw new Error(KEY_NOT_SAVED_MESSAGE);
  markThisDeviceActive(device.deviceId);
  await tryCatch(deleteSavedDeviceLink(device));
  return { userId: device.userId };
};
