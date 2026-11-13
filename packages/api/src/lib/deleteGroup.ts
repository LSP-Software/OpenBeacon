import type { Prisma } from "@openbeacon/database";
import { TRPCError } from "@trpc/server";
import { env } from "../env.ts";
import { buildGroupAvatarPath } from "./image-upload.ts";
import { deleteFile, extractImageStorageObject } from "./storage.ts";

export const deleteGroup = async ({
  db,
  groupId,
}: {
  db: Pick<Prisma.TransactionClient, "group" | "pendingUpload">;
  groupId: string;
}) => {
  const group = await db.group.findUniqueOrThrow({
    where: { id: groupId },
    select: { image: true },
  });
  const pendingUploads = await db.pendingUpload.findMany({
    where: { groupId, uploadType: "groupAvatar" },
    select: { fileName: true, userId: true },
  });
  for (const upload of pendingUploads) {
    await deleteFile(
      env.S3_BUCKET_NAME,
      buildGroupAvatarPath(upload.userId, groupId),
      upload.fileName,
    );
  }
  if (group.image) {
    const image = extractImageStorageObject(group.image);
    const uploaderId = image?.path.split("/")[1];
    if (
      !image ||
      image.bucketName !== env.S3_BUCKET_NAME ||
      (image.path !== `group/${groupId}/uploads/avatar` &&
        (!uploaderId || image.path !== buildGroupAvatarPath(uploaderId, groupId))) ||
      !image.fileName
    ) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "The group image cannot be removed from storage.",
      });
    }
    await deleteFile(image.bucketName, image.path, image.fileName);
  }
  await db.pendingUpload.deleteMany({ where: { groupId } });
  await db.group.delete({ where: { id: groupId } });
};
