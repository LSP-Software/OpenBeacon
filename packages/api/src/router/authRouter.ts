import { authCapabilities } from "@openbeacon/auth";
import { registerDeviceKeySchema } from "@openbeacon/schemas";
import { listUserRecipientPublicKeys, upsertUserDevice } from "../lib/groupEpochs.ts";
import { protectedProcedure, publicProcedure } from "../procedures/auth/base.ts";
import { createTRPCRouter } from "../trpc.ts";

export const authRouter = createTRPCRouter({
  providers: publicProcedure.query(() => authCapabilities),
  deviceKeyContext: protectedProcedure.query(async ({ ctx }) => ({
    recipients: await listUserRecipientPublicKeys({
      db: ctx.db,
      userId: ctx.session.user.id,
    }),
    userId: ctx.session.user.id,
  })),
  registerDeviceKey: protectedProcedure
    .input(registerDeviceKeySchema)
    .mutation(async ({ ctx, input }) =>
      upsertUserDevice({
        db: ctx.db,
        input,
        userId: ctx.session.user.id,
      }),
    ),
  listMyDeviceKeys: protectedProcedure.query(async ({ ctx }) =>
    ctx.db.userDevice.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: {
        createdAt: true,
        id: true,
        lastSeenAt: true,
        publicKey: true,
        publicKeyAlgorithm: true,
        revokedAt: true,
      },
      where: {
        userId: ctx.session.user.id,
      },
    }),
  ),
});
