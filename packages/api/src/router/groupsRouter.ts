import { GroupRole } from "@openbeacon/database";
import { inviteMemberToGroupSchema } from "@openbeacon/schemas";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { groupAdminProcedure, groupMemberProcedure, protectedProcedure } from "../trpc.ts";

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
  acceptInvite: protectedProcedure
    .input(z.object({ inviteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invite = await ctx.db.groupMemberInvite.findUnique({
        where: { id: input.inviteId, recipientId: ctx.session.user.id },
      });

      if (!invite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      }

      const member = await ctx.db.groupMember.create({
        data: {
          userId: invite.recipientId,
          groupId: invite.groupId,
          role: invite.role,
        },
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
          group: {
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
          },
        },
      });

      if (!member.group) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to accept invite, group does not exist.",
        });
      }

      await ctx.db.groupMemberInvite.delete({
        where: { id: input.inviteId },
      });

      return {
        message: "Invite accepted.",
        group: {
          id: member.group.id,
          name: member.group.name,
          image: member.group.image,
          members: member.group.groupMembers.map((groupMember) => ({
            id: groupMember.id,
            name: groupMember.user.name,
            image: groupMember.user.image,
            role: groupMember.role,
          })),
        } satisfies GroupListItem,
      };
    }),
  declineInvite: protectedProcedure
    .input(z.object({ inviteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.groupMemberInvite.delete({
        where: { id: input.inviteId, recipientId: ctx.session.user.id },
      });

      return {
        message: "Invite declined.",
      };
    }),
  sendInvites: groupAdminProcedure
    .input(inviteMemberToGroupSchema)
    .mutation(async ({ ctx, input }) => {
      const users = await ctx.db.user.findMany({
        where: {
          email: {
            in: input.invites.map((invite) => invite.email),
          },
        },
        include: {
          receivedGroupMemberInvites: {
            where: {
              groupId: input.groupId,
            },
          },
        },
      });

      const invitesToCreate = users
        .map((user) => {
          // don't allow the user to invite themselves
          if (user.id === ctx.session.user.id) return undefined;

          const invite = input.invites.find((invite) => invite.email === user.email);
          if (!invite) return undefined;

          // don't allow the user to invite someone who has already been invited to the same group
          if (user.receivedGroupMemberInvites.find((invite) => invite.groupId === input.groupId))
            return undefined;

          return {
            inviterId: ctx.session.user.id,
            recipientId: user.id,
            groupId: input.groupId,
            role: invite.role,
          };
        })
        .filter((invite) => invite !== undefined);

      await ctx.db.groupMemberInvite.createMany({
        data: invitesToCreate,
      });

      return {
        message:
          "If there are accounts associated with the provided emails an invite will be sent to them.",
      };
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
  invites: protectedProcedure.query(async ({ ctx }) => {
    const invites = await ctx.db.groupMemberInvite.findMany({
      where: {
        recipientId: ctx.session.user.id,
      },
      include: {
        inviter: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    return invites.map((invite) => ({
      id: invite.id,
      inviter: {
        id: invite.inviterId,
        name: invite.inviter.name,
        image: invite.inviter.image,
      },
      group: {
        id: invite.groupId,
        name: invite.group.name,
        image: invite.group.image,
      },
    }));
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
} satisfies TRPCRouterRecord;
