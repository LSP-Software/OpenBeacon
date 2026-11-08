import { tryCatch } from "@openbeacon/shared";
import { trpcClient } from "./api.ts";
import { type GroupColor, isGroupColor, setGroupColor } from "./groupColor.ts";
import { createPersonalDataOpener, resealForSelf, sealForSelf } from "./personalData.ts";

export const groupColorSyncQueryOptions = (userId: string | undefined) => ({
  queryKey: ["personalGroupColors", userId],
  enabled: !!userId,
  staleTime: Number.POSITIVE_INFINITY,
  queryFn: () => (userId ? syncGroupColors(userId) : null),
});

export const saveGroupColor = async ({
  userId,
  groupId,
  color,
}: {
  userId: string;
  groupId: string;
  color: GroupColor;
}) => {
  const ciphertext = await sealForSelf({
    userId,
    purpose: "group-color",
    binding: [userId, groupId],
    plaintext: color,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  const result = await tryCatch(
    trpcClient.groupMembership.updateColor.mutate(
      { groupId, ciphertext },
      { signal: controller.signal },
    ),
  );
  clearTimeout(timeout);
  if (result.error) {
    throw controller.signal.aborted
      ? new Error("Couldn't reach the server. Try again.")
      : result.error;
  }
  setGroupColor(groupId, color);
};

export const syncGroupColors = async (userId: string) => {
  const records = await trpcClient.groupMembership.colors.query();
  const open = createPersonalDataOpener(userId);
  const colors: Parameters<typeof resealForSelf>[0]["records"] = [];
  for (const record of records) {
    const binding = [userId, record.groupId];
    const result = await tryCatch(
      open({ purpose: "group-color", binding, sealed: record.ciphertext }),
    );
    if (!result.data || !isGroupColor(result.data)) continue;
    setGroupColor(record.groupId, result.data);
    colors.push({
      purpose: "group-color",
      binding,
      sealed: record.ciphertext,
      plaintext: result.data,
      upload: (ciphertext: string) =>
        trpcClient.groupMembership.updateColor.mutate({
          groupId: record.groupId,
          ciphertext,
          expectedCiphertext: record.ciphertext,
        }),
    });
  }
  await tryCatch(resealForSelf({ userId, records: colors }));
  return null;
};
