import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";
import { env } from "../env.ts";
import {
  confirmImageUpload,
  createImageOwnerLockKey,
  requestImageUpload,
  requestImageUploadInputSchema,
} from "../lib/image-upload.ts";
import { deleteFile, extractImageStorageObject } from "../lib/storage.ts";
import { tryCatch } from "../lib/tryCatch.ts";
import { protectedProcedure, type TRPCContext } from "../trpc.ts";

type ProtectedTRPCContext = TRPCContext & {
  session: NonNullable<TRPCContext["session"]>;
};

const groupImageInputSchema = z.object({ groupId: z.string() });

const getGroupForGroupImageOrThrow = async ({
  ctx,
  groupId,
}: {
  ctx: ProtectedTRPCContext;
  groupId: string;
}) => {
  const group = await ctx.db.group.findUnique({
    where: { id: groupId },
    select: { id: true, image: true },
  });

  if (!group) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Group not found.",
    });
  }

  return group;
};

const requestGroupImageUpload = async ({
  ctx,
  groupId,
  contentHash,
}: {
  ctx: ProtectedTRPCContext;
  groupId: string;
  contentHash: string;
}) => {
  const userId = ctx.session.user.id;
  await getGroupForGroupImageOrThrow({ ctx, groupId });

  return requestImageUpload({
    bucketName: env.S3_BUCKET_NAME,
    contentHash,
    imagePath: `group/${groupId}/uploads/avatar`,
    replacePendingImageUpload: async (fileName) => {
      let oldFileName: string | null = null;

      await ctx.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${createImageOwnerLockKey(userId)})`;

        const existingPendingGroupImageUpload = await tx.pendingUpload.findUnique({
          where: { userId_uploadType: { userId, uploadType: "groupAvatar" } },
          select: { fileName: true },
        });

        if (existingPendingGroupImageUpload) {
          oldFileName = existingPendingGroupImageUpload.fileName;
          await tx.pendingUpload.delete({
            where: { userId_uploadType: { userId, uploadType: "groupAvatar" } },
          });
        }

        await tx.pendingUpload.create({
          data: { userId, uploadType: "groupAvatar", groupId, fileName },
        });
      });

      return oldFileName;
    },
  });
};

const confirmGroupImageUpload = async ({
  ctx,
  groupId,
}: {
  ctx: ProtectedTRPCContext;
  groupId: string;
}) => {
  const group = await getGroupForGroupImageOrThrow({ ctx, groupId });

  return confirmImageUpload({
    bucketName: env.S3_BUCKET_NAME,
    imagePath: `group/${groupId}/uploads/avatar`,
    getPendingImageUpload: () =>
      ctx.db.pendingUpload.findFirst({
        where: { uploadType: "groupAvatar", groupId },
        select: { fileName: true },
      }),
    clearPendingImageUpload: async () => {
      await ctx.db.pendingUpload.deleteMany({
        where: { uploadType: "groupAvatar", groupId },
      });
    },
    getCurrentImageUrl: async () => group.image ?? null,
    setCurrentImageUrl: async (imageUrl) => {
      await ctx.db.group.update({
        where: { id: groupId },
        data: { image: imageUrl },
      });
    },
    noPendingImageUploadMessage: "No pending group image upload to confirm.",
  });
};

export const groupsRouter = {
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.group.findUnique({
        where: { id: input.id },
        select: {
          image: true,
        },
      });

      await ctx.db.group.delete({ where: { id: input.id } });

      if (group?.image) {
        const groupImageStorageObject = extractImageStorageObject(group.image);
        if (groupImageStorageObject) {
          await tryCatch(
            deleteFile(
              groupImageStorageObject.bucketName,
              groupImageStorageObject.path,
              groupImageStorageObject.fileName,
            ),
          );
        }
      }

      const pendingUploads = await ctx.db.pendingUpload.findMany({
        where: { uploadType: "groupAvatar", groupId: input.id },
        select: { fileName: true },
      });

      if (pendingUploads.length > 0) {
        for (const pending of pendingUploads) {
          await tryCatch(
            deleteFile(env.S3_BUCKET_NAME, `group/${input.id}/uploads/avatar`, pending.fileName),
          );
        }
        await ctx.db.pendingUpload.deleteMany({
          where: { uploadType: "groupAvatar", groupId: input.id },
        });
      }

      return {
        message: "Group deleted successfully",
      };
    }),
  create: protectedProcedure
    .input(
      z.object({
        name: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.group.create({
        data: {
          name: input.name,
        },
      });

      return {
        id: group.id,
        image: group.image,
        name: group.name,
      };
    }),
  list: protectedProcedure.query(async ({ ctx }) => {
    const groups = await ctx.db.group.findMany({
      select: {
        id: true,
        image: true,
        name: true,
      },
    });

    return groups.map((group) => ({
      id: group.id,
      image: group.image,
      name: group.name,
    }));
  }),
  requestGroupImageUpload: protectedProcedure
    .input(requestImageUploadInputSchema.extend({ groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return requestGroupImageUpload({
        ctx,
        groupId: input.groupId,
        contentHash: input.contentHash,
      });
    }),
  confirmGroupImageUpload: protectedProcedure
    .input(groupImageInputSchema)
    .mutation(async ({ ctx, input }) => {
      return confirmGroupImageUpload({ ctx, groupId: input.groupId });
    }),
} satisfies TRPCRouterRecord;
