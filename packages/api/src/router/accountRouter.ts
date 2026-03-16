import type { TRPCRouterRecord } from "@trpc/server";
import { env } from "../env.ts";
import {
  confirmImageUpload,
  createImageOwnerLockKey,
  requestImageUpload,
  requestImageUploadInputSchema,
} from "../lib/image-upload.ts";
import { protectedProcedure, type TRPCContext } from "../trpc.ts";

type ProtectedTRPCContext = TRPCContext & {
  session: NonNullable<TRPCContext["session"]>;
};

const requestProfileImageUpload = async ({
  ctx,
  contentHash,
}: {
  ctx: ProtectedTRPCContext;
  contentHash: string;
}) => {
  const userId = ctx.session.user.id;

  return requestImageUpload({
    bucketName: env.S3_BUCKET_NAME,
    contentHash,
    imagePath: `user/${userId}/uploads/avatar`,
    replacePendingImageUpload: async (fileName) => {
      let oldFileName: string | null = null;

      await ctx.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${createImageOwnerLockKey(userId)})`;

        const existingPendingProfileImageUpload = await tx.pendingProfileImageUpload.findUnique({
          where: { userId },
          select: { fileName: true },
        });

        if (existingPendingProfileImageUpload) {
          oldFileName = existingPendingProfileImageUpload.fileName;
          await tx.pendingProfileImageUpload.delete({ where: { userId } });
        }

        await tx.pendingProfileImageUpload.create({
          data: { userId, fileName },
        });
      });

      return oldFileName;
    },
  });
};

const confirmProfileImageUpload = async ({ ctx }: { ctx: ProtectedTRPCContext }) => {
  const userId = ctx.session.user.id;

  return confirmImageUpload({
    bucketName: env.S3_BUCKET_NAME,
    imagePath: `user/${userId}/uploads/avatar`,
    getPendingImageUpload: () =>
      ctx.db.pendingProfileImageUpload.findUnique({
        where: { userId },
        select: { fileName: true },
      }),
    clearPendingImageUpload: async () => {
      await ctx.db.pendingProfileImageUpload.delete({ where: { userId } });
    },
    getCurrentImageUrl: async () => {
      const currentUser = await ctx.db.user.findUnique({
        where: { id: userId },
        select: { image: true },
      });

      return currentUser?.image ?? null;
    },
    setCurrentImageUrl: async (imageUrl) => {
      await ctx.db.user.update({
        where: { id: userId },
        data: { image: imageUrl },
      });
    },
    noPendingImageUploadMessage: "No pending profile image upload to confirm.",
  });
};

export const accountRouter = {
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { image: true },
    });
  }),

  requestProfileImageUpload: protectedProcedure
    .input(requestImageUploadInputSchema)
    .mutation(async ({ ctx, input }) => {
      return requestProfileImageUpload({ ctx, contentHash: input.contentHash });
    }),

  confirmProfileImageUpload: protectedProcedure.mutation(async ({ ctx }) => {
    return confirmProfileImageUpload({ ctx });
  }),
} satisfies TRPCRouterRecord;
