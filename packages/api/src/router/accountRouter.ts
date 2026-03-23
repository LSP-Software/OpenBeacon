import type { TRPCRouterRecord } from "@trpc/server";
import { env } from "../env.ts";
import {
  buildUserAvatarPath,
  confirmImageUpload,
  requestImageUpload,
  requestImageUploadInputSchema,
  setPendingImageUploadForUser,
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
      const imagePath = buildUserAvatarPath(userId);
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
        uploadType: "userAvatar",
        fileName,
        bucketName: env.S3_BUCKET_NAME,
        currentImagePath: imagePath,
      });

      return { presignedUrl };
    }),

  confirmProfileImageUpload: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const pendingUpload = await ctx.db.pendingUpload.findUnique({
      where: { userId_uploadType: { userId, uploadType: "userAvatar" } },
      select: { fileName: true },
    });

    const currentUser = await ctx.db.user.findUnique({
      where: { id: userId },
      select: { image: true },
    });
    const currentImageUrl = currentUser?.image ?? null;

    return confirmImageUpload({
      db: ctx.db,
      userId,
      uploadType: "userAvatar",
      bucketName: env.S3_BUCKET_NAME,
      imagePath: buildUserAvatarPath(userId),
      pendingFileName: pendingUpload?.fileName ?? null,
      currentImageUrl,
      noPendingImageUploadMessage: "No pending profile image upload to confirm.",
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
    });
  }),
} satisfies TRPCRouterRecord;
