import { deleteAccountRecords } from "./account-deletion.ts";

export const deleteDueAccount = async (input: Parameters<typeof deleteAccountRecords>[0]) => {
  await input.db.user.updateMany({
    where: { id: input.userId },
    data: { pendingDeletion: true, deletionDate: new Date(0) },
  });
  return deleteAccountRecords(input);
};
