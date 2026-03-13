import { GroupRole } from "@openbeacon/database";
import type { TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { protectedProcedure } from "../trpc.ts";

export const groupsRouter = {
  list: protectedProcedure.query(async ({ ctx }) => {
    const groups = await ctx.db.group.findMany({
      include: {
        groupMembers: {
          where: {
            userId: ctx.session.user.id,
          },
          select: {
            id: true,
            role: true,
            user: {
              select: {
                name: true,
                image: true,
              },
            },
          },
        },
      },
    });

    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      members: group.groupMembers.map((member) => ({
        id: member.id,
        name: member.user.name,
        image: member.user.image,
        role: member.role,
      })),
    }));
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
          groupMembers: {
            create: {
              userId: ctx.session.user.id,
              role: GroupRole.OWNER,
            },
          },
        },
      });

      return {
        id: group.id,
        name: group.name,
      };
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.group.delete({ where: { id: input.id } });

      return {
        message: "Group deleted successfully",
      };
    }),
} satisfies TRPCRouterRecord;
