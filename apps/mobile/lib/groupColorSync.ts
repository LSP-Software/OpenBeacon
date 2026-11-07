import { tryCatch } from "@openbeacon/shared";
import { trpcClient } from "./api.ts";
import { type GroupColor, isGroupColor, setGroupColor } from "./groupColor.ts";
import { openForSelf, sealForSelf } from "./personalData.ts";

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

const syncGroupColors = async (userId: string) => {
  const records = await trpcClient.groupMembership.colors.query();
  for (const record of records) {
    const result = await tryCatch(
      openForSelf({
        userId,
        purpose: "group-color",
        binding: [userId, record.groupId],
        sealed: record.ciphertext,
      }),
    );
    if (result.data && isGroupColor(result.data)) setGroupColor(record.groupId, result.data);
  }
  return null;
};
