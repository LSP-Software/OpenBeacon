import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";
import { env } from "../env.ts";
import {
  buildPublicUrl,
  deleteFile,
  extractStorageKey,
  getPresignedUploadUrl,
  verifyFileExists,
} from "../lib/storage.ts";
import { tryCatch } from "../lib/tryCatch.ts";
import { protectedProcedure } from "../trpc.ts";

const PROFILE_IMAGE_PREFIX = "ob_pfp";

export const accountRouter = {
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { image: true },
    });

    return { imageUrl: user?.image ?? null };
  }),

  requestImageUpload: protectedProcedure
    .input(
      z.object({
        fileSize: z.number(),
        contentHash: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.fileSize > env.MAX_IMAGE_FILE_SIZE) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `File size exceeds the maximum allowed size of ${Math.floor(env.MAX_IMAGE_FILE_SIZE / 1024 / 1024)}MB.`,
        });
      }

      const fileName = `${crypto.randomUUID()}.webp`;

      const { data: presignedUrl, error: presignError } = await tryCatch(
        getPresignedUploadUrl(PROFILE_IMAGE_PREFIX, fileName, "image/webp", input.fileSize),
      );

      if (presignError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to prepare upload. Please try again.",
        });
      }

      return { presignedUrl, fileName };
    }),

  confirmImageUpload: protectedProcedure
    .input(
      z.object({
        fileName: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: exists, error: verifyError } = await tryCatch(
        verifyFileExists(PROFILE_IMAGE_PREFIX, input.fileName),
      );

      if (verifyError || !exists) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Upload could not be verified. Please try uploading again.",
        });
      }

      const currentUser = await ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { image: true },
      });

      if (currentUser?.image) {
        const oldKey = extractStorageKey(currentUser.image);
        if (oldKey) {
          await tryCatch(deleteFile(oldKey.prefix, oldKey.fileName));
        }
      }

      const imageUrl = buildPublicUrl(PROFILE_IMAGE_PREFIX, input.fileName);

      await ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { image: imageUrl },
      });

      return { imageUrl };
    }),
} satisfies TRPCRouterRecord;
