import { Prisma } from "@openbeacon/database";
import { createAccountHistoryKeySchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import { devicePendingError, lockThisDevice } from "../lib/deviceActivation.ts";
import { protectedProcedure } from "../procedures/auth/runtime.ts";
import { createTRPCRouter } from "../trpcRuntime.ts";

const alreadyExists = () =>
  new TRPCError({ code: "CONFLICT", message: "This account already has a history key." });

export const accountHistoryRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createAccountHistoryKeySchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const result = await tryCatch(
        ctx.db.$transaction(async (tx) => {
          const thisDevice = await lockThisDevice({
            db: tx,
            deviceId: ctx.deviceId,
            userId,
          });
          if (!thisDevice.active) throw devicePendingError();
          if (await tx.accountHistoryKey.findFirst({ select: { id: true }, where: { userId } })) {
            throw alreadyExists();
          }
          await tx.accountHistoryKey.create({ data: { ...input, userId, version: 1 } });
        }),
      );
      if (
        result.error instanceof Prisma.PrismaClientKnownRequestError &&
        result.error.code === "P2002"
      ) {
        throw alreadyExists();
      }
      if (result.error) throw result.error;
      return { historyKeyVersion: 1 };
    }),
});
