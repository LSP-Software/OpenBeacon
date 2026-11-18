import { GroupEventType, GroupRole, Prisma } from "@openbeacon/database";
import { resolveHistoryShare, tryCatch } from "@openbeacon/shared";
import {
  confirmGroupImageUploadSchema,
  createGroupSchema,
  presignImageUploadInputSchema,
  setGroupHistoryShareSchema,
} from "@openbeacon/schemas";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { env } from "../../env.ts";
import { recordGroupEvent } from "../../lib/groupHistory.ts";
import { deleteHistoryOutsideShare } from "../../lib/historyShare.ts";
import {
  assertActiveDevices,
  assertLatestGroupEpoch,
  assertSentFromThisDevice,
} from "../../lib/groupWriteChecks.ts";
import { imageChanged, imageFileName, imageKeyColumns } from "../../lib/imageKeys.ts";
import {
  buildGroupAvatarPath,
  confirmImageUpload,
  presignImageUpload,
  setPendingImageUploadForUser,
} from "../../lib/image-upload.ts";
import { deleteFile, deleteImagePrefix } from "../../lib/storage.ts";
import { protectedProcedure } from "../../procedures/auth/runtime.ts";
import { groupMemberProcedure, groupAdminProcedure } from "../../procedures/auth/group.ts";

export const groupSettingsRouter = {
  setHistoryShare: groupMemberProcedure
    .meta({ rateLimit: { limit: 30, windowMs: 60_000 } })
    .input(setGroupHistoryShareSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`,
        );
        const updated = await tx.groupMember.updateManyAndReturn({
          where: { userId, groupId: input.groupId },
          data: { historyShare: input.historyShare },
          select: { historyShare: true, user: { select: { historyShare: true } } },
        });
        const member = updated[0];
        if (!member) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this group" });
        }
        await tx.user.update({
          where: { id: userId },
          data: { historyShareChangedAt: new Date() },
        });
        const historyShare = resolveHistoryShare({
          account: member.user.historyShare,
          group: member.historyShare,
        });
        const deletedPoints = await deleteHistoryOutsideShare({
          db: tx,
          groupIds: [input.groupId],
          historyShare,
          userId,
        });
        return {
          groupId: input.groupId,
          override: member.historyShare,
          historyShare,
          deletedPoints,
        };
      });
    }),

  rename: groupMemberProcedure
    .input(createGroupSchema.extend({ groupId: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        const [group] = await tx.$queryRaw<Array<{ name: string }>>(
          Prisma.sql`SELECT name FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
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
        if (group && group.name !== input.name) {
          await recordGroupEvent(tx, {
            data: {
              groupId: input.groupId,
              type: GroupEventType.GROUP_RENAMED,
              actorUserId: ctx.session.user.id,
              name: input.name,
              previousName: group.name,
            },
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
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const fileName = crypto.randomUUID();

      await setPendingImageUploadForUser({
        db: ctx.db,
        userId,
        uploadType: "groupAvatar",
        fileName,
        groupId: input.groupId,
        bucketName: env.IMAGES_S3_BUCKET_NAME,
        currentImagePath: buildGroupAvatarPath(userId, input.groupId),
      });

      return { fileName };
    }),
  presignGroupImageUpload: groupAdminProcedure
    .meta({
      rateLimit: {
        limit: 32,
        windowMs: 60_000,
      },
    })
    .input(
      presignImageUploadInputSchema({ maxImageFileSize: env.MAX_IMAGE_FILE_SIZE }).extend({
        groupId: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return presignImageUpload({
        db: ctx.db,
        userId,
        uploadType: "groupAvatar",
        groupId: input.groupId,
        bucketName: env.IMAGES_S3_BUCKET_NAME,
        contentHash: input.contentHash,
        fileSize: input.fileSize,
        imagePath: buildGroupAvatarPath(userId, input.groupId),
        fileName: input.fileName,
        noPendingImageUploadMessage: "No pending group image upload.",
      });
    }),
  confirmGroupImageUpload: protectedProcedure
    .meta({ rateLimit: { limit: 32, windowMs: 60_000 } })
    .input(confirmGroupImageUploadSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      assertSentFromThisDevice(
        [input.key],
        ctx.deviceId,
        "Picture keys must be sent from this device.",
      );
      const imagePath = buildGroupAvatarPath(userId, input.groupId);
      const pending = await ctx.db.pendingUpload.findUnique({
        where: {
          userId_uploadType_groupId: { userId, uploadType: "groupAvatar", groupId: input.groupId },
        },
      });
      if (!pending || pending.groupId !== input.groupId) {
        if (
          !(await ctx.db.group.findUnique({ where: { id: input.groupId }, select: { id: true } }))
        ) {
          const { error } = await tryCatch(
            deleteImagePrefix(env.IMAGES_S3_BUCKET_NAME, `${imagePath}/`),
          );
          if (error) console.error("[image-upload] failed to delete leftover group images");
        }
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
          bucketName: env.IMAGES_S3_BUCKET_NAME,
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
              if (
                input.expectedFileName !== undefined &&
                imageFileName(group.image) !== input.expectedFileName
              ) {
                throw imageChanged();
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
              await assertActiveDevices(tx, { deviceIds: [ctx.deviceId], userId });
              await assertLatestGroupEpoch(tx, {
                epochIds: [input.key.epochId],
                groupId: input.groupId,
              });
              await tx.group.update({
                where: { id: input.groupId },
                data: { image: imageUrl, ...imageKeyColumns(input.key) },
              });
              await recordGroupEvent(tx, {
                data: {
                  groupId: input.groupId,
                  type: GroupEventType.GROUP_IMAGE_CHANGED,
                  actorUserId: userId,
                },
              });
              return group.image;
            }),
        }),
      );
      if (result.error) {
        if (result.error instanceof TRPCError && result.error.code === "NOT_FOUND") {
          await deleteFile(env.IMAGES_S3_BUCKET_NAME, imagePath, pending.fileName);
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
