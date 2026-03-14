import { GroupRole } from "@openbeacon/database";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { protectedProcedure } from "../trpc.ts";

interface GroupListItem {
  id: string;
  name: string;
  image: string | null;
  members: {
    id: string;
    name: string;
    image: string | null;
    role: GroupRole;
  }[];
}

export const groupsRouter = {
  invites: protectedProcedure.query(async ({ ctx }) => {
    return [
      {
        id: "1",
        groupName: "Group 1",
        groupImage: "placeholder.png",
        inviter: {
          id: "1",
          name: "John Doe",
          image: "placeholder.png",
        },
      },
    ];
  }),
  list: protectedProcedure.query(async ({ ctx }) => {
    const groups = await ctx.db.group.findMany({
      where: {
        groupMembers: {
          some: {
            userId: ctx.session.user.id,
          },
        },
      },
      select: {
        id: true,
        name: true,
        image: true,
        groupMembers: {
          select: {
            id: true,
            role: true,
            user: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
          },
        },
      },
    });

    return groups.map(
      (group) =>
        ({
          id: group.id,
          name: group.name,
          image: group.image,
          members: group.groupMembers.map((member) => ({
            id: member.id,
            name: member.user.name,
            image: member.user.image,
            role: member.role,
          })),
        }) satisfies GroupListItem,
    );
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
        include: {
          groupMembers: {
            select: {
              id: true,
              role: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                },
              },
            },
          },
        },
      });

      if (!group) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create group" });
      }

      return {
        message: "Group created successfully",
        newGroup: {
          id: group.id,
          name: group.name,
          image: group.image,
          members: group.groupMembers.map((member) => ({
            id: member.id,
            name: member.user.name,
            image: member.user.image,
            role: member.role,
          })),
        } satisfies GroupListItem,
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
