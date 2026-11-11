import { randomUUID } from "node:crypto";
import { Prisma } from "@openbeacon/database";
import { approveDeviceLinkSchema, deviceLinkIdSchema } from "@openbeacon/schemas";
import { TRPCError } from "@trpc/server";
import { activateDevice, devicePendingError } from "../lib/deviceActivation.ts";
import { removeUserDevice } from "../lib/removeDevice.ts";
import { activeDeviceProcedure, thisDeviceProcedure } from "../procedures/auth/runtime.ts";
import { createTRPCRouter } from "../trpcRuntime.ts";

const linkLifetimeMs = 10 * 60_000;

const findOpenLink = async ({
  db,
  linkId,
  userId,
}: {
  db: Pick<Prisma.TransactionClient, "deviceLink">;
  linkId: string;
  userId: string;
}) => {
  const link = await db.deviceLink.findUnique({
    where: { id: linkId },
    select: {
      completedAt: true,
      expiresAt: true,
      userId: true,
      device: {
        select: {
          activatedAt: true,
          icon: true,
          id: true,
          model: true,
          name: true,
          platform: true,
          publicKey: true,
          revokedAt: true,
        },
      },
    },
  });
  if (!link) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This code has expired. Show a fresh one on your new phone.",
    });
  }
  if (link.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This code is for a different account." });
  }
  if (link.completedAt || link.device.activatedAt || link.device.revokedAt) {
    throw new TRPCError({ code: "CONFLICT", message: "This phone has already been set up." });
  }
  if (link.expiresAt <= new Date()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This code has expired. Show a fresh one on your new phone.",
    });
  }
  return link.device;
};

export const deviceLinkRouter = createTRPCRouter({
  create: thisDeviceProcedure
    .meta({ rateLimit: { limit: 20, windowMs: 60_000 } })
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user.id;
      return ctx.db.$transaction(async (tx) => {
        const device = await tx.userDevice.findFirst({
          select: { activatedAt: true },
          where: { id: ctx.deviceId, userId, revokedAt: null },
        });
        if (!device) throw new TRPCError({ code: "NOT_FOUND" });
        if (device.activatedAt) {
          throw new TRPCError({ code: "CONFLICT", message: "This phone is already set up." });
        }
        const approvers = await tx.userDevice.count({
          where: { userId, activatedAt: { not: null }, revokedAt: null },
        });
        if (approvers === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "None of your other phones are signed in, so there's nothing to scan this code. Use your recovery phrase or start fresh.",
          });
        }
        await tx.deviceLink.deleteMany({ where: { deviceId: ctx.deviceId } });
        const link = await tx.deviceLink.create({
          data: {
            deviceId: ctx.deviceId,
            expiresAt: new Date(Date.now() + linkLifetimeMs),
            id: randomUUID(),
            userId,
          },
          select: { expiresAt: true, id: true },
        });
        return { expiresAt: link.expiresAt, linkId: link.id };
      });
    }),
  get: activeDeviceProcedure
    .meta({ rateLimit: { limit: 30, windowMs: 60_000 } })
    .input(deviceLinkIdSchema)
    .query(async ({ ctx, input }) => {
      const device = await findOpenLink({
        db: ctx.db,
        linkId: input.linkId,
        userId: ctx.session.user.id,
      });
      return {
        deviceId: device.id,
        icon: device.icon,
        model: device.model,
        name: device.name,
        platform: device.platform,
        publicKey: device.publicKey,
      };
    }),
  approve: activeDeviceProcedure
    .meta({ rateLimit: { limit: 10, windowMs: 60_000 } })
    .input(approveDeviceLinkSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`);
        const approver = await tx.userDevice.findFirst({
          select: { id: true },
          where: { id: ctx.deviceId, userId, activatedAt: { not: null }, revokedAt: null },
        });
        if (!approver) throw devicePendingError();
        const device = await findOpenLink({ db: tx, linkId: input.linkId, userId });
        await tx.deviceLink.update({
          where: { id: input.linkId },
          data: {
            approverDeviceId: ctx.deviceId,
            ciphertext: input.ciphertext,
            completedAt: new Date(),
            enc: input.enc,
          },
        });
        if (!(await activateDevice({ activatedBy: "link", db: tx, deviceId: device.id, userId }))) {
          throw new TRPCError({ code: "CONFLICT", message: "This phone has already been set up." });
        }
        return { deviceId: device.id };
      });
    }),
  decline: activeDeviceProcedure
    .meta({ rateLimit: { limit: 10, windowMs: 60_000 } })
    .input(deviceLinkIdSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const link = await ctx.db.deviceLink.findFirst({
        where: { id: input.linkId, userId, completedAt: null, device: { activatedAt: null } },
        select: { deviceId: true },
      });
      if (!link) throw new TRPCError({ code: "NOT_FOUND" });
      const device = await removeUserDevice({
        db: ctx.db,
        deviceId: link.deviceId,
        userId,
        currentSessionId: ctx.session.session.id,
        current: false,
      });
      ctx.securityAlerts?.send(userId, { type: "device-removed", device });
    }),
  status: thisDeviceProcedure
    .meta({ rateLimit: { limit: 60, windowMs: 60_000 } })
    .input(deviceLinkIdSchema)
    .query(async ({ ctx, input }) => {
      const link = await ctx.db.deviceLink.findFirst({
        where: { id: input.linkId, deviceId: ctx.deviceId, userId: ctx.session.user.id },
        select: {
          approverDevice: { select: { publicKey: true } },
          ciphertext: true,
          completedAt: true,
          enc: true,
          expiresAt: true,
        },
      });
      if (!link) throw new TRPCError({ code: "NOT_FOUND" });
      if (link.completedAt && link.approverDevice && link.enc && link.ciphertext) {
        return {
          approverPublicKey: link.approverDevice.publicKey,
          ciphertext: link.ciphertext,
          enc: link.enc,
          state: "approved" as const,
        };
      }
      return {
        expiresAt: link.expiresAt,
        state: link.expiresAt <= new Date() ? "expired" : "waiting",
      } as const;
    }),
});
