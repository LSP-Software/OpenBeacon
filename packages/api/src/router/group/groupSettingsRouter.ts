import { PutObjectCommand } from "@aws-sdk/client-s3";
import { GroupRole, Prisma } from "@openbeacon/database";
import { tryCatch } from "@openbeacon/shared";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { env } from "../../env.ts";
import { buildGroupAvatarPath } from "../../lib/image-upload.ts";
import { buildImagePublicUrl, deleteFile, extractImageStorageObject } from "../../lib/storage.ts";
import { groupAdminProcedure, groupMemberProcedure } from "../../procedures/auth/group.ts";
import { s3Client } from "../../s3client.ts";

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
  uploadGroupImage: groupAdminProcedure
    .meta({ rateLimit: { limit: 10, windowMs: 60_000 } })
    .input(
      z.object({
        groupId: z.string().min(1),
        image: z.base64().max(Math.ceil(env.MAX_IMAGE_FILE_SIZE / 3) * 4),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const bytes = Buffer.from(input.image, "base64");
      if (bytes.length === 0 || bytes.length > env.MAX_IMAGE_FILE_SIZE) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid image size." });
      }
      const imagePath = buildGroupAvatarPath(input.groupId);
      const fileName = `${crypto.randomUUID()}.webp`;
      const imageUrl = buildImagePublicUrl(env.S3_BUCKET_NAME, imagePath, fileName);
      const uploaded = await tryCatch(
        s3Client.send(
          new PutObjectCommand({
            Bucket: env.S3_BUCKET_NAME,
            Key: `${imagePath}/${fileName}`,
            Body: bytes,
            ContentType: "image/webp",
          }),
        ),
      );
      if (uploaded.error) {
        await deleteFile(env.S3_BUCKET_NAME, imagePath, fileName);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Image upload failed.",
          cause: uploaded.error,
        });
      }
      const committed = await tryCatch(
        ctx.db.$transaction(async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
          );
          const actor = await tx.groupMember.findUnique({
            where: { userId_groupId: { userId: ctx.session.user.id, groupId: input.groupId } },
          });
          if (actor?.role !== GroupRole.OWNER && actor?.role !== GroupRole.ADMIN) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "The group no longer exists or you cannot edit it.",
            });
          }
          const group = await tx.group.findUniqueOrThrow({
            where: { id: input.groupId },
            select: { image: true },
          });
          await tx.group.update({ where: { id: input.groupId }, data: { image: imageUrl } });
          return group;
        }),
      );
      if (committed.error) {
        await deleteFile(env.S3_BUCKET_NAME, imagePath, fileName);
        throw committed.error;
      }
      const previous = committed.data.image
        ? extractImageStorageObject(committed.data.image)
        : null;
      if (previous) {
        await tryCatch(deleteFile(previous.bucketName, previous.path, previous.fileName));
      }
      return { imageUrl };
    }),
} satisfies TRPCRouterRecord;
