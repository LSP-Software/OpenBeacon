import { decryptPrivateNickname, encryptPrivateNickname } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { z } from "zod";
import { trpcClient } from "./api.ts";
import { getOrCreateDeviceKeyContext, getStoredDeviceKeyContext } from "./deviceKeys.ts";

const envelopeSchema = z.object({
  version: z.literal(1),
  deviceId: z.string(),
  nonce: z.string(),
  ciphertext: z.string(),
});

export const encryptPersonalNickname = async ({
  groupId,
  memberId,
  userId,
  nickname,
}: {
  groupId: string;
  memberId: string;
  userId: string;
  nickname: string;
}) => {
  const device = await getOrCreateDeviceKeyContext(userId);
  return JSON.stringify({
    ...encryptPrivateNickname({
      privateKey: device.privateKey,
      groupId,
      memberId,
      userId,
      nickname,
    }),
    deviceId: device.deviceId,
  });
};

export const decryptPersonalNickname = async ({
  groupId,
  memberId,
  userId,
  ciphertext,
}: {
  groupId: string;
  memberId: string;
  userId: string;
  ciphertext: string;
}) => {
  const device = await getStoredDeviceKeyContext(userId);
  if (!device) return null;
  const envelope = envelopeSchema.parse(JSON.parse(ciphertext));
  if (envelope.deviceId !== device.deviceId) return null;
  return decryptPrivateNickname({
    privateKey: device.privateKey,
    groupId,
    memberId,
    userId,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
  });
};

export const loadPersonalNicknames = async (groupId: string, userId: string) => {
  const records = await trpcClient.groupMembership.nicknames.query({ groupId });
  const entries = await Promise.all(
    records.map(async (record) => {
      const result = await tryCatch(
        decryptPersonalNickname({
          groupId,
          memberId: record.targetId,
          userId,
          ciphertext: record.ciphertext,
        }),
      );
      return [
        record.targetId,
        { name: result.data ?? null, ciphertext: record.ciphertext },
      ] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<string, { name: string | null; ciphertext: string }>;
};
