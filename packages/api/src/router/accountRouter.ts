import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";
import { env } from "../env.ts";
import {
  buildPublicUrl,
  deleteFile,
  extractStorageKey,
  getFileSize,
  getPresignedUploadUrl,
} from "../lib/storage.ts";
import { tryCatch } from "../lib/tryCatch.ts";
import { protectedProcedure } from "../trpc.ts";

const userIdToLockKey = (userId: string): number => {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = ((h << 5) - h + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

export const accountRouter = {
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { image: true },
    });
  }),

  requestImageUpload: protectedProcedure
    .input(
      z.object({
        fileSize: z.number().int().nonnegative().max(env.MAX_IMAGE_FILE_SIZE),
        contentHash: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const fileName = `${crypto.randomUUID()}.webp`;

      const { data: presignedUrl, error: presignError } = await tryCatch(
        getPresignedUploadUrl(
          env.S3_BUCKET_NAME,
          ctx.session.user.id,
          fileName,
          "image/webp",
          input.contentHash,
        ),
      );

      if (presignError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to generate presigned URL: ${presignError.message}`,
        });
      }

      let oldFileName: string | null = null;
      const userId = ctx.session.user.id;

      await ctx.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${userIdToLockKey(userId)})`;
        const existing = await tx.pendingProfileImageUpload.findUnique({
          where: { userId },
          select: { fileName: true },
        });
        if (existing) {
          oldFileName = existing.fileName;
          await tx.pendingProfileImageUpload.delete({ where: { userId } });
        }
        await tx.pendingProfileImageUpload.create({
          data: { userId, fileName },
        });
      });

      if (oldFileName) {
        await tryCatch(deleteFile(env.S3_BUCKET_NAME, userId, oldFileName));
      }

      return { presignedUrl };
    }),

  confirmImageUpload: protectedProcedure.mutation(async ({ ctx }) => {
    const pending = await ctx.db.pendingProfileImageUpload.findUnique({
      where: { userId: ctx.session.user.id },
    });
    if (!pending) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No pending profile image upload to confirm.",
      });
    }

    const { data: fileSize, error: verifyError } = await tryCatch(
      getFileSize(env.S3_BUCKET_NAME, ctx.session.user.id, pending.fileName),
    );

    if (verifyError) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Upload verification failed: ${verifyError.message ?? "Unknown error."}`,
      });
    }
    if (fileSize === null || fileSize === 0) {
      await tryCatch(deleteFile(env.S3_BUCKET_NAME, ctx.session.user.id, pending.fileName));
      await tryCatch(
        ctx.db.pendingProfileImageUpload.delete({ where: { userId: ctx.session.user.id } }),
      );
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Uploaded file not found or is empty in storage.",
      });
    }
    if (fileSize > env.MAX_IMAGE_FILE_SIZE) {
      await tryCatch(deleteFile(env.S3_BUCKET_NAME, ctx.session.user.id, pending.fileName));
      await tryCatch(
        ctx.db.pendingProfileImageUpload.delete({ where: { userId: ctx.session.user.id } }),
      );
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Uploaded file exceeds the maximum allowed size.",
      });
    }

    const imageUrl = buildPublicUrl(ctx.session.user.id, pending.fileName);

    const currentUser = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { image: true },
    });

    await ctx.db.user.update({
      where: { id: ctx.session.user.id },
      data: { image: imageUrl },
    });

    await tryCatch(
      ctx.db.pendingProfileImageUpload.delete({
        where: { userId: ctx.session.user.id },
      }),
    );

    if (currentUser?.image) {
      const oldKey = extractStorageKey(currentUser.image);
      if (oldKey) {
        await tryCatch(deleteFile(env.S3_BUCKET_NAME, oldKey.path, oldKey.fileName));
      }
    }

    return { imageUrl };
  }),
} satisfies TRPCRouterRecord;
