import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@openbeacon/database";
import { decodeBase64, sealDeviceActivationChallenge } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import z from "zod";
import { activateDevice } from "../lib/deviceActivation.ts";
import { protectedProcedure } from "../procedures/auth/runtime.ts";
import { createTRPCRouter } from "../trpcRuntime.ts";

const challengeLifetimeMs = 5 * 60_000;

const challengeIdentifier = (deviceId: string) => `device-activation:${deviceId}`;

const hashChallenge = (challenge: Uint8Array) => createHash("sha256").update(challenge).digest();

const thisDeviceProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.deviceId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This phone isn't registered yet." });
  }
  return next({ ctx: { deviceId: ctx.deviceId } });
});

const challengeValueSchema = z.object({
  hash: z.string(),
  historyKeyVersion: z.number().int().positive(),
});

export const deviceRouter = createTRPCRouter({
  status: protectedProcedure.query(async ({ ctx }) => {
    const device = ctx.deviceId
      ? await ctx.db.userDevice.findFirst({
          select: { activatedAt: true },
          where: { id: ctx.deviceId, userId: ctx.session.user.id, revokedAt: null },
        })
      : null;
    return { activated: Boolean(device?.activatedAt), registered: Boolean(device) };
  }),
  activationChallenge: thisDeviceProcedure
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
      const identifier = challengeIdentifier(ctx.deviceId);
      await ctx.db.$transaction([
        ctx.db.verification.deleteMany({ where: { identifier } }),
        ctx.db.verification.create({
          data: {
            expiresAt: new Date(Date.now() + challengeLifetimeMs),
            id: globalThis.crypto.randomUUID(),
            identifier,
            value: JSON.stringify({
              hash: hashChallenge(challenge).toString("base64"),
              historyKeyVersion: historyKey.version,
            } satisfies z.infer<typeof challengeValueSchema>),
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
  activate: thisDeviceProcedure
    .meta({ rateLimit: { limit: 20, windowMs: 60_000 } })
    .input(z.object({ answer: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const deviceId = ctx.deviceId;
      const answer = await tryCatch(Promise.resolve().then(() => decodeBase64(input.answer)));
      const identifier = challengeIdentifier(deviceId);
      const stored = await ctx.db.verification.findFirst({
        select: { expiresAt: true, value: true },
        where: { identifier },
      });
      await ctx.db.verification.deleteMany({ where: { identifier } });
      const parsed = stored
        ? await tryCatch(Promise.resolve().then((): unknown => JSON.parse(stored.value)))
        : null;
      const value = challengeValueSchema.safeParse(parsed?.data).data;
      const expected = value ? Buffer.from(value.hash, "base64") : null;
      const actual = answer.data ? hashChallenge(answer.data) : null;
      const answered =
        stored !== null &&
        stored.expiresAt > new Date() &&
        expected !== null &&
        actual !== null &&
        expected.length === actual.length &&
        timingSafeEqual(expected, actual);
      return ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`);
        const currentHistoryKey = await tx.accountHistoryKey.findFirst({
          orderBy: { version: "desc" },
          select: { version: true },
          where: { userId },
        });
        if (!answered || currentHistoryKey?.version !== value?.historyKeyVersion) {
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
});
