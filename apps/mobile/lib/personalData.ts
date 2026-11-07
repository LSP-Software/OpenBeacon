import {
  openPersonalData,
  type PersonalDataPurpose,
  sealPersonalData,
} from "@openbeacon/encryption";
import { getOrCreateDeviceKeyContext, getStoredDeviceKeyContext } from "./deviceKeys.ts";

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
  const device = await getOrCreateDeviceKeyContext(userId);
  return sealPersonalData({ privateKey: device.privateKey, purpose, binding, plaintext });
};

export const openForSelf = async ({
  userId,
  purpose,
  binding,
  sealed,
}: {
  userId: string;
  purpose: PersonalDataPurpose;
  binding: string[];
  sealed: string;
}) => {
  const device = await getStoredDeviceKeyContext(userId);
  if (!device) return null;
  return openPersonalData({ privateKey: device.privateKey, purpose, binding, sealed });
};
