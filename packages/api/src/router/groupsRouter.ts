import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";
import { env } from "../env.ts";
import {
  buildGroupAvatarPath,
  confirmImageUpload,
  requestImageUpload,
  requestImageUploadInputSchema,
  setPendingImageUploadForUser,
} from "../lib/image-upload.ts";
import { deleteFile, extractImageStorageObject } from "../lib/storage.ts";
import { tryCatch } from "../lib/tryCatch.ts";
import { protectedProcedure } from "../trpc.ts";

const groupImageInputSchema = z.object({ groupId: z.string() });

//TODO: Move all of the protected procedures to group spesific procedures.
//TODO: Check permission for the group before changing the image.

export const groupsRouter = {
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.group.findUnique({
        where: { id: input.id },
        select: {
          image: true,
        },
      });

      await ctx.db.group.delete({ where: { id: input.id } });

      if (group?.image) {
        const groupImageStorageObject = extractImageStorageObject(group.image);
        if (groupImageStorageObject) {
          await tryCatch(
            deleteFile(
              groupImageStorageObject.bucketName,
              groupImageStorageObject.path,
              groupImageStorageObject.fileName,
            ),
          );
        }
      }

      const pendingUploads = await ctx.db.pendingUpload.findMany({
        where: { uploadType: "groupAvatar", groupId: input.id },
        select: { fileName: true },
      });

      if (pendingUploads.length > 0) {
        const avatarPath = buildGroupAvatarPath(input.id);
        for (const pending of pendingUploads) {
          await tryCatch(deleteFile(env.S3_BUCKET_NAME, avatarPath, pending.fileName));
        }
        await ctx.db.pendingUpload.deleteMany({
          where: { uploadType: "groupAvatar", groupId: input.id },
        });
      }

      return {
        message: "Group deleted successfully",
      };
    }),
  create: protectedProcedure
    .input(
      z.object({
        name: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.group.create({
        data: {
          name: input.name,
        },
      });

      return {
        id: group.id,
        image: group.image,
        name: group.name,
      };
    }),
  list: protectedProcedure.query(async ({ ctx }) => {
    const groups = await ctx.db.group.findMany({
      select: {
        id: true,
        image: true,
        name: true,
      },
    });

    return groups.map((group) => ({
      id: group.id,
      image: group.image,
      name: group.name,
    }));
  }),
  requestGroupImageUpload: protectedProcedure
    .input(requestImageUploadInputSchema.extend({ groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const imagePath = buildGroupAvatarPath(input.groupId);
      const fileName = `${crypto.randomUUID()}.webp`;

      const { presignedUrl } = await requestImageUpload({
        bucketName: env.S3_BUCKET_NAME,
        contentHash: input.contentHash,
        fileSize: input.fileSize,
        imagePath,
        fileName,
      });

      await setPendingImageUploadForUser({
        db: ctx.db,
        userId,
        uploadType: "groupAvatar",
        fileName,
        groupId: input.groupId,
        bucketName: env.S3_BUCKET_NAME,
        currentImagePath: imagePath,
      });

      return { presignedUrl };
    }),

  confirmGroupImageUpload: protectedProcedure
    .input(groupImageInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const pendingRow = await ctx.db.pendingUpload.findUnique({
        where: { userId_uploadType: { userId, uploadType: "groupAvatar" } },
        select: { fileName: true, groupId: true },
      });
      const pendingUpload =
        pendingRow?.groupId === input.groupId ? { fileName: pendingRow.fileName } : null;

      const currentGroup = await ctx.db.group.findUnique({
        where: { id: input.groupId },
        select: { image: true },
      });
      const currentImageUrl = currentGroup?.image ?? null;

      return confirmImageUpload({
        db: ctx.db,
        userId,
        uploadType: "groupAvatar",
        bucketName: env.S3_BUCKET_NAME,
        imagePath: buildGroupAvatarPath(input.groupId),
        pendingFileName: pendingUpload?.fileName ?? null,
        currentImageUrl,
        noPendingImageUploadMessage: "No pending group image upload to confirm.",
        commitImageUpload: async (imageUrl) => {
          await ctx.db.$transaction(async (tx) => {
            await tx.group.update({
              where: { id: input.groupId },
              data: { image: imageUrl },
            });
            await tx.pendingUpload.delete({
              where: { userId_uploadType: { userId, uploadType: "groupAvatar" } },
            });
          });
        },
      });
    }),
} satisfies TRPCRouterRecord;
