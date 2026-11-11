import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { type DeviceChallengePurpose, Prisma, type PrismaClient } from "@openbeacon/database";
import {
  decodeBase64,
  sealDeviceActivationChallenge,
  sealSessionLinkChallenge,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import z from "zod";
import { activateDevice } from "../lib/deviceActivation.ts";
import { setupDeviceProcedure, setupProcedure } from "../procedures/auth/runtime.ts";
import { createTRPCRouter } from "../trpcRuntime.ts";

const challengeLifetimeMs = 5 * 60_000;

const hashChallenge = (challenge: Uint8Array) => createHash("sha256").update(challenge).digest();

const takeChallenge = async (
  db: Pick<PrismaClient, "deviceChallenge">,
  where: { deviceId?: string; purpose: DeviceChallengePurpose; sessionId?: string },
) => {
  const challenge = await db.deviceChallenge.findFirst({ orderBy: { createdAt: "desc" }, where });
  const taken = challenge
    ? await db.deviceChallenge.deleteMany({ where: { id: challenge.id } })
    : null;
  return taken?.count === 1 ? challenge : null;
};

const isCorrectAnswer = async ({
  answer,
  challenge,
}: {
  answer: string;
  challenge: { challengeHash: string; expiresAt: Date } | null;
}) => {
  const decoded = await tryCatch(Promise.resolve().then(() => decodeBase64(answer)));
  if (!challenge || !decoded.data || challenge.expiresAt <= new Date()) return false;
  const expected = Buffer.from(challenge.challengeHash, "base64");
  const actual = hashChallenge(decoded.data);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const findDeviceToLink = async ({
  ctx,
  deviceId,
}: {
  ctx: {
    db: Pick<PrismaClient, "session" | "userDevice">;
    session: { session: { id: string }; user: { id: string } };
  };
  deviceId: string;
}) => {
  const session = await ctx.db.session.findUnique({
    select: { deviceId: true },
    where: { id: ctx.session.session.id },
  });
  if (session?.deviceId === deviceId) return null;
  if (session?.deviceId !== null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This sign-in already belongs to another phone. Sign in again.",
    });
  }
  const device = await ctx.db.userDevice.findFirst({
    select: { publicKey: true },
    where: { id: deviceId, userId: ctx.session.user.id, revokedAt: null },
  });
  if (!device) {
    throw new TRPCError({ code: "NOT_FOUND", message: "This phone isn't registered yet." });
  }
  return device;
};

const sessionLinkInput = z.object({ deviceId: z.string().min(1).max(128) });

export const deviceRouter = createTRPCRouter({
  status: setupProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const thisDeviceId = ctx.deviceId ?? ctx.unverifiedDeviceId;
    const [device, otherActiveDevices] = await Promise.all([
      ctx.deviceId
        ? ctx.db.userDevice.findFirst({
            select: { activatedAt: true },
            where: { id: ctx.deviceId, userId, revokedAt: null },
          })
        : null,
      ctx.db.userDevice.count({
        where: {
          userId,
          activatedAt: { not: null },
          revokedAt: null,
          ...(thisDeviceId ? { id: { not: thisDeviceId } } : {}),
        },
      }),
    ]);
    return {
      accountHasActiveDevice: otherActiveDevices > 0,
      activated: Boolean(device?.activatedAt),
      registered: Boolean(device),
    };
  }),
  activationChallenge: setupDeviceProcedure
    .meta({ rateLimit: { limit: 20, windowMs: 60_000 } })
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user.id;
      const historyKey = await ctx.db.accountHistoryKey.findFirst({
        orderBy: { version: "desc" },
        select: { publicKey: true, version: true },
        where: { userId },
      });
      if (!historyKey) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This account has no history key." });
      }
      const challenge = new Uint8Array(randomBytes(32));
      await ctx.db.$transaction([
        ctx.db.deviceChallenge.deleteMany({
          where: { deviceId: ctx.deviceId, purpose: "activation" },
        }),
        ctx.db.deviceChallenge.create({
          data: {
            challengeHash: hashChallenge(challenge).toString("base64"),
            deviceId: ctx.deviceId,
            expiresAt: new Date(Date.now() + challengeLifetimeMs),
            historyKeyVersion: historyKey.version,
            id: globalThis.crypto.randomUUID(),
            purpose: "activation",
          },
        }),
      ]);
      return {
        historyKeyVersion: historyKey.version,
        sealed: sealDeviceActivationChallenge({
          challenge,
          deviceId: ctx.deviceId,
          historyPublicKey: historyKey.publicKey,
          userId,
        }),
      };
    }),
  activate: setupDeviceProcedure
    .meta({ rateLimit: { limit: 20, windowMs: 60_000 } })
    .input(z.object({ answer: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const deviceId = ctx.deviceId;
      const alreadyActive = await ctx.db.userDevice.findFirst({
        select: { id: true },
        where: { id: deviceId, userId, activatedAt: { not: null }, revokedAt: null },
      });
      if (alreadyActive) return { activated: true };
      const stored = await takeChallenge(ctx.db, { deviceId, purpose: "activation" });
      await ctx.db.deviceChallenge.deleteMany({ where: { deviceId, purpose: "activation" } });
      const answered = await isCorrectAnswer({ answer: input.answer, challenge: stored });
      return ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`,
        );
        const currentHistoryKey = await tx.accountHistoryKey.findFirst({
          orderBy: { version: "desc" },
          select: { version: true },
          where: { userId },
        });
        if (
          !answered ||
          !stored?.historyKeyVersion ||
          currentHistoryKey?.version !== stored.historyKeyVersion
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This phone couldn't prove it holds your history key. Try again.",
          });
        }
        await activateDevice({ activatedBy: "phrase", db: tx, deviceId, userId });
        const device = await tx.userDevice.findFirst({
          select: { activatedAt: true },
          where: { id: deviceId, userId, revokedAt: null },
        });
        if (!device?.activatedAt) throw new TRPCError({ code: "NOT_FOUND" });
        return { activated: true };
      });
    }),
  sessionChallenge: setupProcedure
    .meta({ rateLimit: { limit: 20, windowMs: 60_000 } })
    .input(sessionLinkInput)
    .mutation(async ({ ctx, input }) => {
      const device = await findDeviceToLink({ ctx, deviceId: input.deviceId });
      if (!device) return { linked: true as const };
      const sessionId = ctx.session.session.id;
      const challenge = new Uint8Array(randomBytes(32));
      const stored = {
        challengeHash: hashChallenge(challenge).toString("base64"),
        createdAt: new Date(),
        deviceId: input.deviceId,
        expiresAt: new Date(Date.now() + challengeLifetimeMs),
        id: globalThis.crypto.randomUUID(),
        purpose: "sessionLink" as const,
      };
      await ctx.db.deviceChallenge.upsert({
        create: { ...stored, sessionId },
        update: stored,
        where: { sessionId },
      });
      return {
        linked: false as const,
        sealed: sealSessionLinkChallenge({
          challenge,
          deviceId: input.deviceId,
          devicePublicKey: device.publicKey,
          userId: ctx.session.user.id,
        }),
      };
    }),
  linkSession: setupProcedure
    .meta({ rateLimit: { limit: 20, windowMs: 60_000 } })
    .input(sessionLinkInput.extend({ answer: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      if (!(await findDeviceToLink({ ctx, deviceId: input.deviceId }))) return { linked: true };
      const userId = ctx.session.user.id;
      const sessionId = ctx.session.session.id;
      const stored = await takeChallenge(ctx.db, { purpose: "sessionLink", sessionId });
      const answered =
        stored?.deviceId === input.deviceId &&
        (await isCorrectAnswer({ answer: input.answer, challenge: stored }));
      if (!answered) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This phone couldn't prove it's yours. Try again.",
        });
      }
      const linked = await ctx.db.$transaction(async (tx) => {
        const device = await tx.userDevice.findFirst({
          select: { id: true },
          where: { id: input.deviceId, userId, revokedAt: null },
        });
        if (!device) return 0;
        const updated = await tx.session.updateMany({
          data: { deviceId: device.id },
          where: { id: sessionId, userId, deviceId: null },
        });
        return updated.count;
      });
      if (linked === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This phone couldn't be confirmed. Sign in again.",
        });
      }
      return { linked: true };
    }),
});
