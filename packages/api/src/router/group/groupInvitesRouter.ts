import { groupEpochBundleSchema, inviteMemberToGroupSchema } from "@openbeacon/schemas";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { getInviteAcceptanceContext, persistGroupEpoch } from "../../lib/groupEpochs.ts";
import { protectedProcedure } from "../../procedures/auth/base.ts";
import { groupAdminProcedure } from "../../procedures/auth/group.ts";
import type { GroupListItem } from "../../types/GroupListItem.ts";

export const groupInvitesRouter = {
  acceptanceContext: protectedProcedure
    .input(z.object({ inviteId: z.string().min(1) }))
    .query(async ({ ctx, input }) =>
      getInviteAcceptanceContext({
        db: ctx.db,
        inviteId: input.inviteId,
        userId: ctx.session.user.id,
      }),
    ),
  accept: protectedProcedure
    .meta({
      rateLimit: {
        limit: 10,
        windowMs: 60_000,
      },
    })
    .input(
      z.object({
        inviteId: z.string().min(1),
        nextEpoch: groupEpochBundleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.$transaction(async (tx) => {
        const invite = await tx.groupMemberInvite.findFirst({
          where: { id: input.inviteId, recipientId: ctx.session.user.id },
        });

        if (!invite) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
        }

        const createdMember = await tx.groupMember.create({
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

        if (!createdMember.group) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to accept invite, group does not exist.",
          });
        }

        await tx.groupMemberInvite.delete({
          where: { id: input.inviteId },
        });

        await persistGroupEpoch({
          db: tx,
          epoch: input.nextEpoch,
          groupId: invite.groupId,
          userId: ctx.session.user.id,
        });

        return createdMember;
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
  decline: protectedProcedure
    .meta({
      rateLimit: {
        limit: 20,
        windowMs: 60_000,
      },
    })
    .input(z.object({ inviteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.groupMemberInvite.delete({
        where: { id: input.inviteId, recipientId: ctx.session.user.id },
      });

      return {
        message: "Invite declined.",
      };
    }),
  send: groupAdminProcedure
    .meta({
      rateLimit: {
        limit: 10,
        windowMs: 60_000,
      },
    })
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

      const existingMembers = await ctx.db.groupMember.findMany({
        where: {
          groupId: input.groupId,
          userId: {
            in: users.map((user) => user.id),
          },
        },
      });

      const existingMemberIds = new Set(existingMembers.map((member) => member.userId));

      const invitesToCreate = users
        .map((user) => {
          if (user.id === ctx.session.user.id) return undefined;

          if (existingMemberIds.has(user.id)) return undefined;

          const invite = input.invites.find((invite) => invite.email === user.email);
          if (!invite) return undefined;

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
  list: protectedProcedure.query(async ({ ctx }) => {
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
} satisfies TRPCRouterRecord;
