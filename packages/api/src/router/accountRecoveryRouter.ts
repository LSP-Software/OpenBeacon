import { Prisma } from "@openbeacon/database";
import {
  changeRecoveryPhraseSchema,
  emailCodeSchema,
  resetAccountRecoverySchema,
  setupAccountRecoverySchema,
} from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import type z from "zod";
import {
  freshSessionProcedure,
  requireFreshSession,
  requireThisDevice,
  sessionFreshForMs,
  setupProcedure,
} from "../procedures/auth/runtime.ts";
import { createTRPCRouter } from "../trpcRuntime.ts";
import { activateDevice, devicePendingError, lockThisDevice } from "../lib/deviceActivation.ts";

const emailCodeProcedure = setupProcedure.use(requireFreshSession).use(({ ctx, next }) => {
  if (!ctx.emailCodes) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Email isn't set up on this server." });
  }
  return next({ ctx: { emailCodes: ctx.emailCodes } });
});

const createHistoryKey = async (
  tx: Prisma.TransactionClient,
  userId: string,
  historyKey: z.infer<typeof resetAccountRecoverySchema>["historyKey"],
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

const replaceEscrows = async (
  tx: Prisma.TransactionClient,
  userId: string,
  escrows: z.infer<typeof changeRecoveryPhraseSchema>["escrows"],
) => {
  const historyKeys = await tx.accountHistoryKey.findMany({
    select: { version: true },
    where: { userId },
  });
  const existingVersions = new Set(historyKeys.map(({ version }) => version));
  const escrowVersions = new Set(escrows.map(({ version }) => version));
  if (
    escrowVersions.size !== escrows.length ||
    escrowVersions.size !== existingVersions.size ||
    [...escrowVersions].some((version) => !existingVersions.has(version))
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Escrows must cover exactly the existing history key versions.",
    });
  }
  for (const escrow of escrows) {
    await tx.accountHistoryKey.update({
      data: {
        escrowAlgorithm: escrow.algorithm,
        escrowCiphertext: escrow.ciphertext,
        escrowEnc: escrow.enc,
      },
      where: { userId_version: { userId, version: escrow.version } },
    });
  }
};

export const accountRecoveryRouter = createTRPCRouter({
  status: setupProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [recoveryKey, historyKeys, freshForMs] = await Promise.all([
      ctx.db.recoveryKey.findUnique({
        select: { algorithm: true, derivationVersion: true, publicKey: true },
        where: { userId },
      }),
      ctx.db.accountHistoryKey.findMany({
        orderBy: { version: "asc" },
        select: { id: true, publicKey: true, version: true },
        where: { userId },
      }),
      sessionFreshForMs(ctx.session.session.createdAt),
    ]);
    return {
      currentHistoryKey: historyKeys.at(-1) ?? null,
      freshForMs,
      historyKeys: historyKeys.map(({ publicKey, version }) => ({ publicKey, version })),
      historyKeyVersions: historyKeys.map(({ version }) => version),
      recoveryKey,
      sessionFresh: freshForMs === null || freshForMs > 0,
    };
  }),
  escrows: setupProcedure.query(async ({ ctx }) => {
    const historyKeys = await ctx.db.accountHistoryKey.findMany({
      orderBy: { version: "asc" },
      where: { userId: ctx.session.user.id },
    });
    return historyKeys.flatMap(
      ({ escrowAlgorithm, escrowCiphertext, escrowEnc, id, publicKey, userId, version }) =>
        escrowAlgorithm && escrowCiphertext && escrowEnc
          ? [
              {
                escrow: {
                  algorithm: escrowAlgorithm,
                  ciphertext: escrowCiphertext,
                  enc: escrowEnc,
                },
                id,
                publicKey,
                userId,
                version,
              },
            ]
          : [],
    );
  }),
  setup: freshSessionProcedure
    .input(setupAccountRecoverySchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await ctx.db.$transaction(async (tx) => {
        const thisDevice = await lockThisDevice({
          db: tx,
          deviceId: ctx.deviceId,
          userId,
        });
        if (!thisDevice.active) throw devicePendingError();
        if (await tx.recoveryKey.findUnique({ where: { userId } })) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A recovery phrase is already set up.",
          });
        }
        await replaceEscrows(tx, userId, input.escrows);
        await tx.recoveryKey.create({ data: { ...input.recoveryKey, userId } });
      });
      return { historyKeyVersions: input.escrows.map(({ version }) => version) };
    }),
  changePhrase: freshSessionProcedure
    .input(changeRecoveryPhraseSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await ctx.db.$transaction(async (tx) => {
        const thisDevice = await lockThisDevice({
          db: tx,
          deviceId: ctx.deviceId,
          userId,
        });
        if (!thisDevice.active) throw devicePendingError();
        if (!(await tx.recoveryKey.findUnique({ where: { userId } }))) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No recovery phrase is set up." });
        }
        await replaceEscrows(tx, userId, input.escrows);
        await tx.recoveryKey.update({ data: input.recoveryKey, where: { userId } });
      });
      ctx.securityAlerts?.send(userId, { type: "recovery-phrase-changed" });
      return { historyKeyVersions: input.escrows.map(({ version }) => version) };
    }),
  requestResetCode: emailCodeProcedure.mutation(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      select: { email: true, id: true },
      where: { id: ctx.session.user.id },
    });
    const allowed = await ctx.emailCodes.allowRequest({
      purpose: "recovery-reset",
      email: user.email,
      ip: ctx.clientIp ?? null,
    });
    if (allowed !== "allowed") {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message:
          allowed === "unavailable"
            ? "Codes can't be sent right now. Try again in a minute."
            : "Too many requests. Please try again later.",
      });
    }
    await ctx.emailCodes.send({
      purpose: "recovery-reset",
      subject: user.id,
      to: user.email,
      userId: user.id,
    });
    return { email: user.email };
  }),
  verifyResetCode: emailCodeProcedure.input(emailCodeSchema).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const result = await ctx.emailCodes.check({
      code: input.code,
      purpose: "recovery-reset",
      subject: userId,
    });
    if (!result.valid) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The code is wrong or has expired." });
    }
    return {
      resetToken: await ctx.emailCodes.issueToken({ purpose: "recovery-reset", value: userId }),
    };
  }),
  reset: setupProcedure
    .use(requireFreshSession)
    .use(requireThisDevice)
    .input(resetAccountRecoverySchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { deviceId, emailCodes } = ctx;
      if (emailCodes && !input.resetToken) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Confirm the code we emailed you.",
        });
      }
      await ctx.db.$transaction(async (tx) => {
        const thisDevice = await lockThisDevice({
          db: tx,
          deviceId,
          userId,
        });
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
        if (
          emailCodes &&
          input.resetToken &&
          !(await emailCodes.consumeToken({
            purpose: "recovery-reset",
            token: input.resetToken,
            value: userId,
            tx,
          }))
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Your email confirmation has expired. Confirm a new code.",
          });
        }
        if (
          !(await activateDevice({ activatedBy: "reset", db: tx, deviceId, userId })) &&
          !thisDevice.active
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: "This phone isn't registered yet." });
        }
        await tx.accountHistoryKey.deleteMany({ where: { userId } });
        await tx.recoveryKey.deleteMany({ where: { userId } });
        await tx.recoveryKey.create({ data: { ...input.recoveryKey, userId } });
        await createHistoryKey(tx, userId, input.historyKey);
      });
      ctx.securityAlerts?.send(userId, { type: "recovery-phrase-reset" });
      return { historyKeyVersion: input.historyKey.version };
    }),
});
