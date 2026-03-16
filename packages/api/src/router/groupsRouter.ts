import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";
import { env } from "../env.ts";
import {
  buildGroupAvatarPath,
  clearPendingImageUploadForGroup,
  confirmImageUpload,
  getGroupForGroupImageOrThrow,
  getPendingImageUploadForGroup,
  replacePendingImageUploadForUser,
  requestImageUpload,
  requestImageUploadInputSchema,
} from "../lib/image-upload.ts";
import { protectedProcedure } from "../trpc.ts";

const groupImageInputSchema = z.object({ groupId: z.string() });

export const groupsRouter = {
  requestGroupImageUpload: protectedProcedure
    .input(requestImageUploadInputSchema.extend({ groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await getGroupForGroupImageOrThrow({ db: ctx.db, groupId: input.groupId });

      return requestImageUpload({
        bucketName: env.S3_BUCKET_NAME,
        contentHash: input.contentHash,
        imagePath: buildGroupAvatarPath(input.groupId),
        replacePendingImageUpload: (fileName) =>
          replacePendingImageUploadForUser(
            {
              db: ctx.db,
              userId,
              uploadType: "groupAvatar",
              fileName,
              groupId: input.groupId,
            }
          ),
      });
    }),

  confirmGroupImageUpload: protectedProcedure
    .input(groupImageInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const group = await getGroupForGroupImageOrThrow({ db: ctx.db, groupId: input.groupId });

      return confirmImageUpload({
        bucketName: env.S3_BUCKET_NAME,
        imagePath: buildGroupAvatarPath(input.groupId),
        getPendingImageUpload: () =>
          getPendingImageUploadForGroup({
            db: ctx.db,
            groupId: input.groupId,
            uploadType: "groupAvatar",
            userId,
          }),
        clearPendingImageUpload: () =>
          clearPendingImageUploadForGroup({
            db: ctx.db,
            uploadType: "groupAvatar",
            userId,
          }),
        getCurrentImageUrl: async () => group.image ?? null,
        setCurrentImageUrl: async (imageUrl) => {
          await ctx.db.group.update({
            where: { id: input.groupId },
            data: { image: imageUrl },
          });
        },
        noPendingImageUploadMessage: "No pending group image upload to confirm.",
      });
    }),
} satisfies TRPCRouterRecord;
