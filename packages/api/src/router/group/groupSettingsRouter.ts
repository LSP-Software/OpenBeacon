import { requestImageUploadInputSchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { env } from "../../env.ts";
import {
  buildGroupAvatarPath,
  confirmImageUpload,
  requestImageUpload,
  setPendingImageUploadForUser,
} from "../../lib/image-upload.ts";
import { groupAdminProcedure } from "../../procedures/auth/group.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";
import { GroupRole, Prisma } from "@openbeacon/database";
import { TRPCError } from "@trpc/server";

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
        limit: 10,
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
  confirmGroupImageUpload: groupAdminProcedure
    .meta({
      rateLimit: {
        limit: 20,
        windowMs: 60_000,
      },
    })
    .input(z.object({ groupId: z.string() }))
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
          return ctx.db.$transaction(async (tx) => {
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
            );
            const actor = await tx.groupMember.findUnique({
              where: { userId_groupId: { userId, groupId: input.groupId } },
            });
            if (actor?.role !== GroupRole.OWNER && actor?.role !== GroupRole.ADMIN) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not an admin of this group",
              });
            }
            const pending = await tx.pendingUpload.findUnique({
              where: { userId_uploadType: { userId, uploadType: "groupAvatar" } },
            });
            if (
              pending?.groupId !== input.groupId ||
              pending.fileName !== pendingUpload?.fileName
            ) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "The pending upload has changed.",
              });
            }
            const group = await tx.group.findUniqueOrThrow({
              where: { id: input.groupId },
              select: { image: true },
            });
            await tx.group.update({
              where: { id: input.groupId },
              data: { image: imageUrl },
            });
            await tx.pendingUpload.delete({
              where: { userId_uploadType: { userId, uploadType: "groupAvatar" } },
            });
            return group.image;
          });
        },
      });
    }),
} satisfies TRPCRouterRecord;
