import { tryCatch } from "@openbeacon/shared";

export const deleteDrivesEverywhere = async ({
  driveIds,
  deleteOnServer,
  deleteHere,
}: {
  driveIds: string[];
  deleteOnServer: (driveIds: string[]) => Promise<unknown>;
  deleteHere: (driveIds: string[]) => Promise<void>;
}) => {
  for (let index = 0; index < driveIds.length; index += 500) {
    const batch = driveIds.slice(index, index + 500);
    const server = await tryCatch(deleteOnServer(batch));
    if (server.error) return false;
    const here = await tryCatch(deleteHere(batch));
    if (here.error) return false;
  }
  return true;
};
