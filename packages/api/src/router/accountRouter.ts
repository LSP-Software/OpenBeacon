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
        getPresignedUploadUrl(ctx.session.user.id, fileName, "image/webp", input.contentHash),
      );

      if (presignError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to generate presigned URL: ${presignError.message}`,
        });
      }

      return { presignedUrl, fileName };
    }),

  confirmImageUpload: protectedProcedure
    .input(
      z.object({
        fileName: z
          .string()
          .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: fileSize, error: verifyError } = await tryCatch(
        getFileSize(ctx.session.user.id, input.fileName),
      );

      if (verifyError || fileSize === null || fileSize === 0 || fileSize > env.MAX_IMAGE_FILE_SIZE) {
        await tryCatch(deleteFile(env.S3_BUCKET_NAME, ctx.session.user.id, input.fileName));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Upload verification failed: ${verifyError?.message ?? "Unknown error."}`,
        });
      }

      const imageUrl = buildPublicUrl(ctx.session.user.id, input.fileName);

      const currentUser = await ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { image: true },
      });

      await ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { image: imageUrl },
      });

      if (currentUser?.image) {
        const oldKey = extractStorageKey(currentUser.image);
        if (oldKey) {
          await tryCatch(deleteFile(env.S3_BUCKET_NAME, oldKey.path, oldKey.fileName));
        }
      }

      return { imageUrl };
    }),
} satisfies TRPCRouterRecord;
