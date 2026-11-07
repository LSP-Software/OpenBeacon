import { auth } from "@openbeacon/auth";
import { Prisma } from "@openbeacon/database";
import {
  changeRecoveryPhraseSchema,
  resetAccountRecoverySchema,
  setupAccountRecoverySchema,
} from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import type z from "zod";
import { protectedProcedure } from "../procedures/auth/runtime.ts";
import { createTRPCRouter } from "../trpcRuntime.ts";

const freshSessionProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const { sessionConfig } = await auth.$context;
  const sessionAge = Date.now() - new Date(ctx.session.session.createdAt).getTime();
  if (sessionConfig.freshAge !== 0 && sessionAge >= sessionConfig.freshAge * 1000) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sign in again to continue." });
  }
  return next();
});

const lockUser = (tx: Prisma.TransactionClient, userId: string) =>
  tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`);

const createHistoryKey = async (
  tx: Prisma.TransactionClient,
  userId: string,
  historyKey: z.infer<typeof setupAccountRecoverySchema>["historyKey"],
) => {
  const result = await tryCatch(
    tx.accountHistoryKey.create({
      data: {
        algorithm: historyKey.algorithm,
        escrowAlgorithm: historyKey.escrow.algorithm,
        escrowCiphertext: historyKey.escrow.ciphertext,
        escrowEnc: historyKey.escrow.enc,
        id: historyKey.id,
        publicKey: historyKey.publicKey,
        userId,
        version: historyKey.version,
      },
    }),
  );
  if (
    result.error instanceof Prisma.PrismaClientKnownRequestError &&
    result.error.code === "P2002"
  ) {
    throw new TRPCError({ code: "CONFLICT", message: "That history key ID is already in use." });
  }
  if (result.error) throw result.error;
};

export const accountRecoveryRouter = createTRPCRouter({
  status: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [recoveryKey, historyKeys] = await Promise.all([
      ctx.db.recoveryKey.findUnique({
        select: { algorithm: true, derivationVersion: true, publicKey: true },
        where: { userId },
      }),
      ctx.db.accountHistoryKey.findMany({
        orderBy: { version: "asc" },
        select: { id: true, publicKey: true, version: true },
        where: { userId },
      }),
    ]);
    return {
      currentHistoryKey: historyKeys.at(-1) ?? null,
      historyKeyVersions: historyKeys.map(({ version }) => version),
      recoveryKey,
    };
  }),
  escrows: protectedProcedure.query(async ({ ctx }) => {
    const historyKeys = await ctx.db.accountHistoryKey.findMany({
      orderBy: { version: "asc" },
      where: { userId: ctx.session.user.id },
    });
    return historyKeys.map((historyKey) => ({
      escrow: {
        algorithm: historyKey.escrowAlgorithm,
        ciphertext: historyKey.escrowCiphertext,
        enc: historyKey.escrowEnc,
      },
      id: historyKey.id,
      publicKey: historyKey.publicKey,
      userId: historyKey.userId,
      version: historyKey.version,
    }));
  }),
  setup: protectedProcedure.input(setupAccountRecoverySchema).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    if (input.historyKey.version !== 1) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The first history key must be v1." });
    }
    await ctx.db.$transaction(async (tx) => {
      await lockUser(tx, userId);
      if (await tx.recoveryKey.findUnique({ where: { userId } })) {
        throw new TRPCError({ code: "CONFLICT", message: "A recovery phrase is already set up." });
      }
      await tx.recoveryKey.create({ data: { ...input.recoveryKey, userId } });
      await createHistoryKey(tx, userId, input.historyKey);
    });
    return { historyKeyVersion: input.historyKey.version };
  }),
  changePhrase: freshSessionProcedure
    .input(changeRecoveryPhraseSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await ctx.db.$transaction(async (tx) => {
        await lockUser(tx, userId);
        if (!(await tx.recoveryKey.findUnique({ where: { userId } }))) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No recovery phrase is set up." });
        }
        const historyKeys = await tx.accountHistoryKey.findMany({
          select: { version: true },
          where: { userId },
        });
        const existingVersions = new Set(historyKeys.map(({ version }) => version));
        const escrowVersions = new Set(input.escrows.map(({ version }) => version));
        if (
          escrowVersions.size !== input.escrows.length ||
          escrowVersions.size !== existingVersions.size ||
          [...escrowVersions].some((version) => !existingVersions.has(version))
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Escrows must cover exactly the existing history key versions.",
          });
        }
        await tx.recoveryKey.update({ data: input.recoveryKey, where: { userId } });
        for (const escrow of input.escrows) {
          await tx.accountHistoryKey.update({
            data: {
              escrowAlgorithm: escrow.algorithm,
              escrowCiphertext: escrow.ciphertext,
              escrowEnc: escrow.enc,
            },
            where: { userId_version: { userId, version: escrow.version } },
          });
        }
      });
      return { historyKeyVersions: input.escrows.map(({ version }) => version) };
    }),
  reset: freshSessionProcedure
    .input(resetAccountRecoverySchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await ctx.db.$transaction(async (tx) => {
        await lockUser(tx, userId);
        if (!(await tx.recoveryKey.findUnique({ where: { userId } }))) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No recovery phrase is set up." });
        }
        const latestHistoryKey = await tx.accountHistoryKey.findFirst({
          orderBy: { version: "desc" },
          select: { version: true },
          where: { userId },
        });
        if (input.historyKey.version !== (latestHistoryKey?.version ?? 0) + 1) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "The history key version has changed. Fetch the status and try again.",
          });
        }
        await tx.accountHistoryKey.deleteMany({ where: { userId } });
        await tx.recoveryKey.delete({ where: { userId } });
        await tx.recoveryKey.create({ data: { ...input.recoveryKey, userId } });
        await createHistoryKey(tx, userId, input.historyKey);
      });
      return { historyKeyVersion: input.historyKey.version };
    }),
});
