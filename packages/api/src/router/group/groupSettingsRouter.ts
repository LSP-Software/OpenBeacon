import { GroupRole, Prisma } from "@openbeacon/database";
import { tryCatch } from "@openbeacon/shared";
import { requestImageUploadInputSchema } from "@openbeacon/schemas";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { env } from "../../env.ts";
import {
  buildGroupAvatarPath,
  confirmImageUpload,
  requestImageUpload,
  setPendingImageUploadForUser,
} from "../../lib/image-upload.ts";
import { deleteFile } from "../../lib/storage.ts";
import { protectedProcedure } from "../../procedures/auth/runtime.ts";
import { groupAdminProcedure, groupMemberProcedure } from "../../procedures/auth/group.ts";

export const groupSettingsRouter = {
  rename: groupMemberProcedure
    .input(z.object({ groupId: z.string().min(1), name: z.string().trim().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
        );
        const actor = await tx.groupMember.findUnique({
          where: { userId_groupId: { userId: ctx.session.user.id, groupId: input.groupId } },
        });
        if (actor?.role !== GroupRole.OWNER && actor?.role !== GroupRole.ADMIN) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only owners and admins can rename the group.",
          });
        }
        return tx.group.update({ where: { id: input.groupId }, data: { name: input.name } });
      });
    }),

  requestGroupImageUpload: groupAdminProcedure
    .meta({
      rateLimit: {
        limit: 32,
        windowMs: 60_000,
      },
    })
    .input(
      requestImageUploadInputSchema({ maxImageFileSize: env.MAX_IMAGE_FILE_SIZE }).extend({
        groupId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const imagePath = buildGroupAvatarPath(userId, input.groupId);
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
    .meta({ rateLimit: { limit: 32, windowMs: 60_000 } })
    .input(z.object({ groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const imagePath = buildGroupAvatarPath(userId, input.groupId);
      const pending = await ctx.db.pendingUpload.findUnique({
        where: { userId_uploadType: { userId, uploadType: "groupAvatar" } },
      });
      if (!pending || pending.groupId !== input.groupId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No pending group image upload to confirm.",
        });
      }
      const result = await tryCatch(
        confirmImageUpload({
          db: ctx.db,
          userId,
          uploadType: "groupAvatar",
          bucketName: env.S3_BUCKET_NAME,
          imagePath,
          pendingFileName: pending.fileName,
          currentImageUrl: null,
          noPendingImageUploadMessage: "No pending group image upload to confirm.",
          commitImageUpload: async (imageUrl) =>
            ctx.db.$transaction(async (tx) => {
              await tx.$queryRaw(
                Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
              );
              const group = await tx.group.findUnique({
                where: { id: input.groupId },
                select: { image: true },
              });
              if (!group) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Group no longer exists." });
              }
              const member = await tx.groupMember.findUnique({
                where: { userId_groupId: { userId, groupId: input.groupId } },
              });
              if (member?.role !== GroupRole.OWNER && member?.role !== GroupRole.ADMIN) {
                throw new TRPCError({
                  code: "FORBIDDEN",
                  message: "You are not an admin of this group.",
                });
              }
              const deleted = await tx.pendingUpload.deleteMany({
                where: {
                  userId,
                  uploadType: "groupAvatar",
                  groupId: input.groupId,
                  fileName: pending.fileName,
                },
              });
              if (deleted.count !== 1) {
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: "No pending group image upload to confirm.",
                });
              }
              await tx.group.update({ where: { id: input.groupId }, data: { image: imageUrl } });
              return group.image;
            }),
        }),
      );
      if (result.error) {
        if (result.error instanceof TRPCError && result.error.code === "NOT_FOUND") {
          await deleteFile(env.S3_BUCKET_NAME, imagePath, pending.fileName);
          await ctx.db.pendingUpload.deleteMany({
            where: {
              userId,
              uploadType: "groupAvatar",
              groupId: input.groupId,
              fileName: pending.fileName,
            },
          });
        }
        throw result.error;
      }
      return result.data;
    }),
} satisfies TRPCRouterRecord;
