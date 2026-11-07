import { tryCatch } from "@openbeacon/shared";
import { trpcClient } from "./api.ts";
import { openForSelf, sealForSelf } from "./personalData.ts";

export const encryptPersonalNickname = ({
  groupId,
  memberId,
  userId,
  nickname,
}: {
  groupId: string;
  memberId: string;
  userId: string;
  nickname: string;
}) =>
  sealForSelf({
    userId,
    purpose: "nickname",
    binding: [userId, groupId, memberId],
    plaintext: nickname,
  });

export const decryptPersonalNickname = ({
  groupId,
  memberId,
  userId,
  ciphertext,
}: {
  groupId: string;
  memberId: string;
  userId: string;
  ciphertext: string;
}) =>
  openForSelf({
    userId,
    purpose: "nickname",
    binding: [userId, groupId, memberId],
    sealed: ciphertext,
  });

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
