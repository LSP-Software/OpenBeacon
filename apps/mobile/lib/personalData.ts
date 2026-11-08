import {
  getHistoryPublicKey,
  getPersonalDataHistoryKeyVersion,
  openPersonalData,
  type PersonalDataPurpose,
  sealPersonalData,
  sealPersonalDataForHistoryKey,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { trpcClient } from "./api.ts";
import { getOrCreateDeviceKeyContext, getStoredDeviceKeyContext } from "./deviceKeys.ts";
import { createHistoryKeyReader } from "./epochKeys.ts";
import { getStoredHistoryKey } from "./historyKeys.ts";

export const PERSONAL_DATA_LOCKED_MESSAGE =
  "Restore your recovery phrase on this phone to change nicknames and colors.";
export const PERSONAL_DATA_KEY_MISMATCH_MESSAGE =
  "The server's history key doesn't match this phone, so nothing was saved.";

const getCurrentHistoryKey = async (userId: string) => {
  const { currentHistoryKey } = await trpcClient.accountRecovery.status.query();
  if (!currentHistoryKey) return { status: "none" as const };
  const { publicKey, version } = currentHistoryKey;
  const stored = await getStoredHistoryKey({ userId, version });
  if (!stored) return { status: "locked" as const };
  if (getHistoryPublicKey(stored) !== publicKey) return { status: "mismatch" as const };
  return { historyKey: { publicKey, version }, status: "ready" as const };
};

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
  const current = await getCurrentHistoryKey(userId);
  if (current.status === "locked") throw new Error(PERSONAL_DATA_LOCKED_MESSAGE);
  if (current.status === "mismatch") throw new Error(PERSONAL_DATA_KEY_MISMATCH_MESSAGE);
  if (current.status === "ready") {
    return sealPersonalDataForHistoryKey({
      historyKey: current.historyKey,
      purpose,
      binding,
      plaintext,
    });
  }
  const device = await getOrCreateDeviceKeyContext(userId);
  return sealPersonalData({ privateKey: device.privateKey, purpose, binding, plaintext });
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

export const openForSelf = ({
  userId,
  ...input
}: {
  userId: string;
  purpose: PersonalDataPurpose;
  binding: string[];
  sealed: string;
}) => createPersonalDataOpener(userId)(input);

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
  const current = await getCurrentHistoryKey(userId);
  if (current.status !== "ready") return 0;
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
