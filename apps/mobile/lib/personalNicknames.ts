import { tryCatch } from "@openbeacon/shared";
import { trpcClient } from "./api.ts";
import {
  createPersonalDataOpener,
  openForSelf,
  resealForSelf,
  sealForSelf,
} from "./personalData.ts";

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
  const open = createPersonalDataOpener(userId);
  const nicknames = await Promise.all(
    records.map(async (record) => {
      const opened = await tryCatch(
        open({
          purpose: "nickname",
          binding: [userId, groupId, record.targetId],
          sealed: record.ciphertext,
        }),
      );
      return { ...record, name: opened.data ?? null };
    }),
  );
  await tryCatch(
    resealForSelf({
      userId,
      records: nicknames.flatMap((nickname) =>
        nickname.name === null
          ? []
          : {
              purpose: "nickname" as const,
              binding: [userId, groupId, nickname.targetId],
              sealed: nickname.ciphertext,
              plaintext: nickname.name,
              upload: async (ciphertext: string) => {
                await trpcClient.groupMembership.updateNickname.mutate({
                  groupId,
                  memberId: nickname.targetId,
                  ciphertext,
                  expectedCiphertext: nickname.ciphertext,
                });
                nickname.ciphertext = ciphertext;
              },
            },
      ),
    }),
  );
  return Object.fromEntries(
    nicknames.map(({ targetId, name, ciphertext }) => [targetId, { name, ciphertext }]),
  ) as Record<string, { name: string | null; ciphertext: string }>;
};
