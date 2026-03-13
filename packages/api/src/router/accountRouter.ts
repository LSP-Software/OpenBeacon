import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";
import { env } from "../env.ts";
import {
  buildPublicUrl,
  deleteFile,
  extractStorageKey,
  getFileSize,
  getPresignedUploadUrl,
  verifyPublicUrl,
} from "../lib/storage.ts";
import { tryCatch } from "../lib/tryCatch.ts";
import { protectedProcedure } from "../trpc.ts";

const PROFILE_IMAGE_PREFIX = "";

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
        getPresignedUploadUrl(PROFILE_IMAGE_PREFIX, fileName, "image/webp", input.contentHash),
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
        getFileSize(PROFILE_IMAGE_PREFIX, input.fileName),
      );

      if (verifyError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Upload verification failed: ${verifyError.message}`,
        });
      }
      if (fileSize === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Uploaded file not found in storage. The upload may have failed or expired.",
        });
      }
      if (fileSize === 0) {
        await tryCatch(deleteFile(PROFILE_IMAGE_PREFIX, input.fileName));
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Uploaded file is empty (zero bytes). The upload may have failed.",
        });
      }
      if (fileSize > env.MAX_IMAGE_FILE_SIZE) {
        await tryCatch(deleteFile(PROFILE_IMAGE_PREFIX, input.fileName));
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `File size exceeds the maximum allowed size of ${Math.floor(env.MAX_IMAGE_FILE_SIZE / 1024 / 1024)}MB.`,
        });
      }

      const imageUrl = buildPublicUrl(PROFILE_IMAGE_PREFIX, input.fileName);

      const { data: isPubliclyAccessible, error: verifyUrlError } = await tryCatch(
        verifyPublicUrl(imageUrl),
      );
      if (verifyUrlError || !isPubliclyAccessible) {
        await tryCatch(deleteFile(PROFILE_IMAGE_PREFIX, input.fileName));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Uploaded image is not publicly accessible. The file was uploaded but the CDN URL is unreachable.",
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

      await ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { image: imageUrl },
      });

      return { imageUrl };
    }),
} satisfies TRPCRouterRecord;
