import { GroupRole, Prisma } from "@openbeacon/database";
import { createHash } from "node:crypto";
import {
  auth,
  authCapabilities,
  createGoogleDeletionAuthorization,
  verifyGoogleDeletionCode,
} from "@openbeacon/auth";
import { tryCatch } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import {
  accountNameSchema,
  requestImageUploadInputSchema,
  updateDeviceSchema,
} from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod";
import { env } from "../env.ts";
import {
  buildUserAvatarPath,
  confirmImageUpload,
  requestImageUpload,
  setPendingImageUploadForUser,
} from "../lib/image-upload.ts";
import { deleteAccountRecords } from "../lib/account-deletion.ts";
import { freshSessionProcedure, protectedProcedure } from "../procedures/auth/runtime.ts";

export const accountRouter = {
  deletionVerificationMethods: protectedProcedure.query(async ({ ctx }) => {
    const accounts = await ctx.db.account.findMany({
      where: { userId: ctx.session.user.id },
      select: { providerId: true, password: true },
    });
    return {
      password: accounts.some(
        (account) => account.providerId === "credential" && Boolean(account.password),
      ),
      google:
        authCapabilities.google && accounts.some((account) => account.providerId === "google"),
    };
  }),
  beginGoogleDeletionVerification: protectedProcedure
    .meta({ rateLimit: { limit: 5, windowMs: 60_000 } })
    .mutation(async ({ ctx }) => {
      if (
        !authCapabilities.google ||
        !(await ctx.db.account.findFirst({
          where: { userId: ctx.session.user.id, providerId: "google" },
          select: { id: true },
        }))
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Google sign-in is not available for this account.",
        });
      }
      const authorization = createGoogleDeletionAuthorization();
      await ctx.db.$transaction(async (tx) => {
        await tx.googleDeletionChallenge.deleteMany({
          where: { OR: [{ sessionId: ctx.session.session.id }, { expiresAt: { lt: new Date() } }] },
        });
        await tx.googleDeletionChallenge.create({
          data: {
            id: createHash("sha256").update(authorization.state).digest("hex"),
            userId: ctx.session.user.id,
            sessionId: ctx.session.session.id,
            nonce: authorization.nonce,
            codeVerifier: authorization.codeVerifier,
            expiresAt: new Date(Date.now() + 5 * 60_000),
          },
        });
      });
      return { url: authorization.url, state: authorization.state };
    }),
  requestDeletion: protectedProcedure
    .meta({ rateLimit: { limit: 5, windowMs: 60_000 } })
    .input(
      z.union([
        z.object({ password: z.string().min(1).max(1024), immediate: z.boolean().optional() }),
        z.object({
          immediate: z.boolean().optional(),
          google: z.object({
            state: z.string().min(1).max(128),
            code: z.string().min(1).max(4096),
          }),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      let googleSubject: string | null = null;
      let challengeId: string | null = null;
      if ("google" in input) {
        challengeId = createHash("sha256").update(input.google.state).digest("hex");
        const challenge = await ctx.db.googleDeletionChallenge.findFirst({
          where: {
            id: challengeId,
            userId,
            sessionId: ctx.session.session.id,
            expiresAt: { gt: new Date() },
          },
        });
        if (!challenge)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Google verification expired. Please try again.",
          });
        const verification = await tryCatch(
          verifyGoogleDeletionCode({
            code: input.google.code,
            codeVerifier: challenge.codeVerifier,
            nonce: challenge.nonce,
          }),
        );
        if (verification.error || !verification.data)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Google verification failed. Please try again.",
          });
        googleSubject = verification.data;
      }
      const result = await ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`);
        const session = await tx.session.findFirst({
          where: { id: ctx.session.session.id, userId },
        });
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });
        if ("password" in input) {
          const account = await tx.account.findFirst({
            where: { userId, providerId: "credential" },
            select: { password: true },
          });
          const authContext = await auth.$context;
          if (
            !account?.password ||
            !(await authContext.password.verify({
              hash: account.password,
              password: input.password,
            }))
          ) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Password is incorrect.",
            });
          }
        } else {
          const account = await tx.account.findFirst({
            where: { userId, providerId: "google", accountId: googleSubject ?? "" },
            select: { id: true },
          });
          if (!account || !challengeId)
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "The Google account does not match this account.",
            });
          const consumed = await tx.googleDeletionChallenge.deleteMany({
            where: {
              id: challengeId,
              userId,
              sessionId: ctx.session.session.id,
              expiresAt: { gt: new Date() },
            },
          });
          if (consumed.count !== 1)
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Google verification expired. Please try again.",
            });
        }
        const memberships = await tx.groupMember.findMany({
          where: { userId },
          select: { groupId: true },
        });
        const groupIds = memberships.map(({ groupId }) => groupId).sort();
        if (groupIds.length) {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "Group" WHERE id IN (${Prisma.join(groupIds)}) ORDER BY id FOR UPDATE`,
          );
          const soleOwner = await tx.groupMember.findFirst({
            where: {
              userId,
              role: GroupRole.OWNER,
              group: {
                AND: [
                  { groupMembers: { some: { userId: { not: userId } } } },
                  {
                    groupMembers: {
                      none: {
                        userId: { not: userId },
                        role: GroupRole.OWNER,
                        user: { pendingDeletion: false },
                      },
                    },
                  },
                ],
              },
            },
            select: { id: true },
          });
          if (soleOwner)
            throw new TRPCError({
              code: "CONFLICT",
              message: "Transfer ownership or delete your groups before deleting your account.",
            });
          const soloGroups = await tx.group.findMany({
            where: { id: { in: groupIds }, groupMembers: { none: { userId: { not: userId } } } },
            select: { id: true },
          });
          const soloGroupIds = soloGroups.map(({ id }) => id);
          await tx.groupMemberInvite.deleteMany({ where: { groupId: { in: soloGroupIds } } });
          await tx.groupSharedInvite.deleteMany({ where: { groupId: { in: soloGroupIds } } });
        }
        await tx.groupMemberInvite.deleteMany({
          where: { OR: [{ inviterId: userId }, { recipientId: userId }] },
        });
        await tx.groupSharedInvite.deleteMany({ where: { creatorId: userId } });
        const [clock] = await tx.$queryRaw<Array<{ deletionDate: Date }>>(
          Prisma.sql`SELECT clock_timestamp() + (${input.immediate ? 0 : 168} * INTERVAL '1 hour') AS "deletionDate"`,
        );
        if (!clock) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { deletionDate } = clock;
        await tx.user.update({
          where: { id: userId },
          data: { pendingDeletion: true, deletionDate, deletionRetryAt: null },
        });
        await tx.session.deleteMany({ where: { userId } });
        return { deletionDate };
      });
      if (input.immediate) {
        await tryCatch(
          deleteAccountRecords({
            db: ctx.db,
            userId,
            imageUrlPrefix: `${env.S3_CDN_URL}/${env.S3_BUCKET_NAME}`,
            mode: "scheduled",
            securityAlerts: ctx.securityAlerts,
          }),
        );
      } else {
        ctx.securityAlerts?.send(userId, {
          type: "deletion-scheduled",
          deletionDate: result.deletionDate,
        });
      }
      return result;
    }),
  signOutOtherSessions: freshSessionProcedure
    .meta({ rateLimit: { limit: 5, windowMs: 60_000 } })
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user.id;
      const others = { userId, id: { not: ctx.session.session.id } };
      const now = new Date();
      const signedOut = await ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`);
        const live = await tx.session.deleteMany({ where: { ...others, expiresAt: { gt: now } } });
        await tx.session.deleteMany({ where: { ...others, expiresAt: { lte: now } } });
        return live.count;
      });
      if (signedOut > 0) ctx.securityAlerts?.send(userId, { type: "other-sessions-signed-out" });
      return { signedOut };
    }),
  deletionCancellationNotice: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.session.user.id },
      select: { deletionCancellationPending: true },
    });
    return { cancelled: user.deletionCancellationPending };
  }),
  acknowledgeDeletionCancellation: protectedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId !== ctx.session.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.db.user.updateMany({
        where: { id: ctx.session.user.id, deletionCancellationPending: true },
        data: { deletionCancellationPending: false },
      });
    }),
  updateName: protectedProcedure
    .input(z.object({ name: accountNameSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { name: input.name },
        select: { name: true },
      });
    }),
  listDevices: protectedProcedure.query(async ({ ctx }) => {
    const devices = await ctx.db.userDevice.findMany({
      where: { userId: ctx.session.user.id, revokedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        icon: true,
        platform: true,
        model: true,
        createdAt: true,
        lastSeenAt: true,
        lastLocationAt: true,
        activatedAt: true,
      },
    });
    return devices.map((device) => ({ ...device, isCurrent: device.id === ctx.deviceId }));
  }),
  updateDevice: protectedProcedure
    .meta({ rateLimit: { limit: 30, windowMs: 60_000 } })
    .input(updateDeviceSchema)
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db.userDevice.updateMany({
        where: { id: input.deviceId, userId: ctx.session.user.id, revokedAt: null },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.icon !== undefined ? { icon: input.icon } : {}),
        },
      });
      if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
    }),
  version: protectedProcedure.query(({ ctx }) => ctx.serverVersion),
  serverName: protectedProcedure.query(({ ctx }) => ctx.serverName),
  requestProfileImageUpload: protectedProcedure
    .meta({
      rateLimit: {
        limit: 10,
        windowMs: 60_000,
      },
    })
    .input(
      requestImageUploadInputSchema({
        maxImageFileSize: env.MAX_IMAGE_FILE_SIZE,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const imagePath = buildUserAvatarPath(userId);
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
        uploadType: "userAvatar",
        fileName,
        bucketName: env.S3_BUCKET_NAME,
        currentImagePath: imagePath,
      });

      return { presignedUrl };
    }),
  confirmProfileImageUpload: protectedProcedure
    .meta({
      rateLimit: {
        limit: 20,
        windowMs: 60_000,
      },
    })
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user.id;

      const pendingUpload = await ctx.db.pendingUpload.findUnique({
        where: { userId_uploadType_groupId: { userId, uploadType: "userAvatar", groupId: "" } },
        select: { fileName: true },
      });

      const currentUser = await ctx.db.user.findUnique({
        where: { id: userId },
        select: { image: true },
      });

      return confirmImageUpload({
        db: ctx.db,
        userId,
        uploadType: "userAvatar",
        bucketName: env.S3_BUCKET_NAME,
        imagePath: buildUserAvatarPath(userId),
        pendingFileName: pendingUpload?.fileName ?? null,
        currentImageUrl: currentUser?.image ?? null,
        noPendingImageUploadMessage: "No pending profile image upload to confirm.",
        commitImageUpload: async (imageUrl) => {
          await ctx.db.$transaction(async (tx) => {
            await tx.user.update({
              where: { id: userId },
              data: { image: imageUrl },
            });
            await tx.pendingUpload.delete({
              where: {
                userId_uploadType_groupId: { userId, uploadType: "userAvatar", groupId: "" },
              },
            });
          });
        },
      });
    }),
} satisfies TRPCRouterRecord;
