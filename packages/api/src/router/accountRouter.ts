import type { TRPCRouterRecord } from "@trpc/server";
import { env } from "../env.ts";
import {
  buildUserAvatarPath,
  clearPendingImageUploadForUser,
  confirmImageUpload,
  getPendingImageUploadForUser,
  replacePendingImageUploadForUser,
  requestImageUpload,
  requestImageUploadInputSchema,
} from "../lib/image-upload.ts";
import { protectedProcedure } from "../trpc.ts";

export const accountRouter = {
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { image: true },
    });
  }),

  requestProfileImageUpload: protectedProcedure
    .input(requestImageUploadInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      return requestImageUpload({
        bucketName: env.S3_BUCKET_NAME,
        contentHash: input.contentHash,
        imagePath: buildUserAvatarPath(userId),
        replacePendingImageUpload: (fileName) =>
          replacePendingImageUploadForUser({
            db: ctx.db,
            userId,
            uploadType: "userAvatar",
            fileName,
          }),
      });
    }),

  confirmProfileImageUpload: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    return confirmImageUpload({
      bucketName: env.S3_BUCKET_NAME,
      imagePath: buildUserAvatarPath(userId),
      getPendingImageUpload: () =>
        getPendingImageUploadForUser({
          db: ctx.db,
          userId,
          uploadType: "userAvatar",
        }),
      commitImageUpload: async (imageUrl) => {
        await ctx.db.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: userId },
            data: { image: imageUrl },
          });
          await tx.pendingUpload.delete({
            where: { userId_uploadType: { userId, uploadType: "userAvatar" } },
          });
        });
      },
      getCurrentImageUrl: async () => {
        const currentUser = await ctx.db.user.findUnique({
          where: { id: userId },
          select: { image: true },
        });

        return currentUser?.image ?? null;
      },
      clearPendingImageUpload: () =>
        clearPendingImageUploadForUser({
          db: ctx.db,
          userId,
          uploadType: "userAvatar",
        }),
      noPendingImageUploadMessage: "No pending profile image upload to confirm.",
    });
  }),
} satisfies TRPCRouterRecord;
