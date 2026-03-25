import type { TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { protectedProcedure } from "../../procedures/auth/base.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";
import type { GroupListItem } from "../../types/GroupListItem.ts";

export const groupMembershipRouter = {
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
  get: groupMemberProcedure.query(async ({ ctx }) => {
    return ctx.group;
  }),
  members: groupMemberProcedure
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
} satisfies TRPCRouterRecord;
