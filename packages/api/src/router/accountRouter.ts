import { requestImageUploadInputSchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod";
import { env } from "../env.ts";
import {
  buildUserAvatarPath,
  confirmImageUpload,
  requestImageUpload,
  setPendingImageUploadForUser,
} from "../lib/image-upload.ts";
import { protectedProcedure } from "../procedures/auth/runtime.ts";

export const accountRouter = {
  submitFeedback: protectedProcedure
    .meta({ rateLimit: { limit: 5, windowMs: 60_000 } })
    .input(
      z.object({
        message: z.string().trim().min(1).max(5000),
        includeEmail: z.boolean(),
        androidVersion: z.string().trim().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.feedback.create({
        data: {
          message: input.message,
          email: input.includeEmail ? ctx.session.user.email : null,
          androidVersion: input.androidVersion ?? null,
        },
      });
    }),
  requestProfileImageUpload: protectedProcedure
    .meta({
      rateLimit: {
        limit: 10,
        windowMs: 60_000,
      },
    })
    .input(requestImageUploadInputSchema({ maxImageFileSize: env.MAX_IMAGE_FILE_SIZE }))
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
  confirmProfileImageUpload: protectedProcedure
    .meta({
      rateLimit: {
        limit: 20,
        windowMs: 60_000,
      },
    })
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user.id;

      const pendingUpload = await ctx.db.pendingUpload.findUnique({
        where: { userId_uploadType: { userId, uploadType: "userAvatar" } },
        select: { fileName: true },
      });

      const currentUser = await ctx.db.user.findUnique({
        where: { id: userId },
        select: { image: true },
      });

      return confirmImageUpload({
        db: ctx.db,
        userId,
        uploadType: "userAvatar",
        bucketName: env.S3_BUCKET_NAME,
        imagePath: buildUserAvatarPath(userId),
        pendingFileName: pendingUpload?.fileName ?? null,
        currentImageUrl: currentUser?.image ?? null,
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
