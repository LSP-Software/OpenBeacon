import type { TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { protectedProcedure } from "../trpc.ts";

export const groupsRouter = {
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.group.delete({ where: { id: input.id } });
      return {
        message: "Group deleted successfully",
      };
    }),
  create: protectedProcedure
    .input(
      z.object({
        name: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.group.create({
        data: {
          name: input.name,
        },
      });

      return {
        id: group.id,
        name: group.name,
      };
    }),
  list: protectedProcedure.query(async ({ ctx }) => {
    const groups = await ctx.db.group.findMany();

    return groups.map((group) => ({
      id: group.id,
      name: group.name,
    }));
  }),
} satisfies TRPCRouterRecord;
