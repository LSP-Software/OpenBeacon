import { GroupRole, Prisma } from "@openbeacon/database";
import { createGroupSchema, groupEpochBundleSchema } from "@openbeacon/schemas";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { env } from "../../env.ts";
import { persistGroupEpoch } from "../../lib/groupEpochs.ts";
import { buildGroupAvatarPath } from "../../lib/image-upload.ts";
import { deleteFile, extractImageStorageObject } from "../../lib/storage.ts";
import { groupOwnerProcedure } from "../../procedures/auth/group.ts";
import { protectedProcedure } from "../../procedures/auth/runtime.ts";
import type { GroupListItem } from "../../types/GroupListItem.ts";

export const groupLifecycleRouter = {
  delete: groupOwnerProcedure
    .meta({
      rateLimit: {
        limit: 5,
        windowMs: 60_000,
      },
    })
    .input(z.object({ groupId: z.string(), onlyIfLastMember: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
          );
          const actor = await tx.groupMember.findUnique({
            where: { userId_groupId: { userId: ctx.session.user.id, groupId: input.groupId } },
          });
          if (actor?.role !== GroupRole.OWNER) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Only owners can delete the group.",
            });
          }
          if (
            input.onlyIfLastMember &&
            (await tx.groupMember.count({ where: { groupId: input.groupId } })) !== 1
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "The group has other members. Please try leaving again.",
            });
          }
          const group = await tx.group.findUniqueOrThrow({
            where: { id: input.groupId },
            select: { image: true },
          });
          const pendingUploads = await tx.pendingUpload.findMany({
            where: { groupId: input.groupId, uploadType: "groupAvatar" },
            select: { fileName: true },
          });
          for (const upload of pendingUploads) {
            await deleteFile(
              env.S3_BUCKET_NAME,
              buildGroupAvatarPath(input.groupId),
              upload.fileName,
            );
          }
          if (group.image) {
            const image = extractImageStorageObject(group.image);
            if (
              !image ||
              image.bucketName !== env.S3_BUCKET_NAME ||
              image.path !== buildGroupAvatarPath(input.groupId) ||
              !image.fileName
            ) {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "The group image cannot be removed from storage.",
              });
            }
            await deleteFile(image.bucketName, image.path, image.fileName);
          }
          await tx.group.delete({ where: { id: input.groupId } });
        },
        { timeout: 15_000 },
      );
      return { message: "Group deleted successfully" };
    }),
  create: protectedProcedure
    .meta({
      rateLimit: {
        limit: 10,
        windowMs: 60_000,
      },
    })
    .input(
      createGroupSchema.extend({
        groupId: z.string().min(1),
        initialEpoch: groupEpochBundleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.$transaction(async (tx) => {
        const createdGroup = await tx.group.create({
          data: {
            id: input.groupId,
            name: input.name,
            groupMembers: {
              create: {
                userId: ctx.session.user.id,
                role: GroupRole.OWNER,
              },
            },
          },
          include: {
            groupMembers: {
              select: {
                id: true,
                role: true,
                user: {
                  select: {
                    id: true,
                    name: true,
                    image: true,
                  },
                },
              },
            },
          },
        });

        await persistGroupEpoch({
          db: tx,
          epoch: input.initialEpoch,
          groupId: input.groupId,
          userId: ctx.session.user.id,
        });

        return createdGroup;
      });

      if (!group) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create group" });
      }

      return {
        message: "Group created successfully",
        newGroup: {
          id: group.id,
          name: group.name,
          image: group.image,
          members: group.groupMembers.map((member) => ({
            id: member.id,
            userId: member.user.id,
            name: member.user.name,
            image: member.user.image,
            role: member.role,
          })),
        } satisfies GroupListItem,
      };
    }),
} satisfies TRPCRouterRecord;
