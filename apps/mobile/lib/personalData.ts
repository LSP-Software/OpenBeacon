import {
  getPersonalDataHistoryKeyVersion,
  openPersonalData,
  type PersonalDataPurpose,
  sealPersonalDataForHistoryKey,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { getCurrentHistoryKeyState } from "./currentHistoryKey.ts";
import { getStoredDeviceKeyContext } from "./deviceKeys.ts";
import { createHistoryKeyReader } from "./epochKeys.ts";

export const PERSONAL_DATA_LOCKED_MESSAGE =
  "Restore your recovery phrase on this phone to change nicknames and colors.";
export const PERSONAL_DATA_KEY_MISMATCH_MESSAGE =
  "The server's history key doesn't match this phone, so nothing was saved.";
export const PERSONAL_DATA_ON_OTHER_DEVICE_MESSAGE =
  "This phone doesn't have your account's history key yet. Set up your recovery phrase on your other phone, then restore it here to change nicknames and colors.";
export const PERSONAL_DATA_NO_HISTORY_KEY_MESSAGE =
  "Your account's history key isn't set up yet, so nothing was saved. Try again in a minute.";

export const sealForSelf = async ({
  userId,
  purpose,
  binding,
  plaintext,
}: {
  userId: string;
  purpose: PersonalDataPurpose;
  binding: string[];
  plaintext: string;
}) => {
  const current = await getCurrentHistoryKeyState(userId);
  if (current.status === "held") {
    return sealPersonalDataForHistoryKey({
      historyKey: current.historyKey,
      purpose,
      binding,
      plaintext,
    });
  }
  throw new Error(
    {
      missing: PERSONAL_DATA_LOCKED_MESSAGE,
      mismatch: PERSONAL_DATA_KEY_MISMATCH_MESSAGE,
      none: PERSONAL_DATA_NO_HISTORY_KEY_MESSAGE,
      onOtherDevice: PERSONAL_DATA_ON_OTHER_DEVICE_MESSAGE,
    }[current.status],
  );
};

export const createPersonalDataOpener = (userId: string) => {
  const readHistoryKey = createHistoryKeyReader(userId);
  let device: ReturnType<typeof getStoredDeviceKeyContext> | undefined;
  return async ({
    purpose,
    binding,
    sealed,
  }: {
    purpose: PersonalDataPurpose;
    binding: string[];
    sealed: string;
  }) => {
    const version = getPersonalDataHistoryKeyVersion(sealed);
    if (version === null) {
      device ??= getStoredDeviceKeyContext(userId);
      const deviceKey = await device;
      if (!deviceKey) return null;
      return openPersonalData({ privateKey: deviceKey.privateKey, purpose, binding, sealed });
    }
    const historyKey = await readHistoryKey(version);
    if (!historyKey) return null;
    return openPersonalData({
      historyPrivateKeys: new Map([[version, historyKey]]),
      purpose,
      binding,
      sealed,
    });
  };
};

export const resealForSelf = async ({
  userId,
  records,
}: {
  userId: string;
  records: {
    purpose: PersonalDataPurpose;
    binding: string[];
    sealed: string;
    plaintext: string;
    upload: (sealed: string) => Promise<unknown>;
  }[];
}) => {
  if (records.length === 0) return 0;
  const current = await getCurrentHistoryKeyState(userId);
  if (current.status !== "held") return 0;
  let resealed = 0;
  for (const { purpose, binding, sealed, plaintext, upload } of records) {
    if (getPersonalDataHistoryKeyVersion(sealed) === current.historyKey.version) continue;
    const uploaded = await tryCatch(
      upload(
        sealPersonalDataForHistoryKey({
          historyKey: current.historyKey,
          purpose,
          binding,
          plaintext,
        }),
      ),
    );
    if (!uploaded.error) resealed += 1;
  }
  return resealed;
};
