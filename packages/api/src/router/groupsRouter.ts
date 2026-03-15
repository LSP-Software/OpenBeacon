import { GroupRole } from "@openbeacon/database";
import { inviteMemberToGroupSchema } from "@openbeacon/schemas";
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
  inviteMember: protectedProcedure
    .input(inviteMemberToGroupSchema)
    .mutation(async ({ ctx, input }) => {
      return {
        message: "Member invited successfully",
      };
    }),
  get: protectedProcedure.input(z.object({ groupId: z.string() })).query(async ({ ctx, input }) => {
    const group = await ctx.db.group.findUnique({
      where: { id: input.groupId },
    });
    return group;
  }),
  members: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .query(async ({ ctx, input }) => {
      const members = await ctx.db.groupMember.findMany({
        where: { groupId: input.groupId },
        select: {
          id: true,
          user: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          role: true,
        },
      });

      const places = ["Home", "Work", "School", "Gym", "Other"];
      const membersWithMockData = members.map((member) => {
        return {
          ...member,
          battery: {
            level: Math.floor(Math.random() * 100),
            charging: Math.random() < 0.5,
          },
          batteryLevel: Math.floor(Math.random() * 100),
          lastLocation: {
            latitude: Math.random() * 180 - 90,
            longitude: Math.random() * 360 - 180,
            timestamp: new Date(Date.now() - Math.floor(Math.random() * 1000000)),
            place: places[Math.floor(Math.random() * places.length)],
          },
        };
      });

      return membersWithMockData;
    }),
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
      await new Promise((resolve) => setTimeout(resolve, 4000));

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
