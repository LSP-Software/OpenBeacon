import { createHash, randomBytes } from "node:crypto";
import { GroupRole, Prisma } from "@openbeacon/database";
import { groupEpochBundleSchema, inviteMemberToGroupSchema } from "@openbeacon/schemas";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import {
  getGroupJoinContext,
  getInviteAcceptanceContext,
  persistGroupEpoch,
} from "../../lib/groupEpochs.ts";
import { createGroupJoinAlerts } from "../../lib/groupJoinAlerts.ts";
import { groupAdminProcedure } from "../../procedures/auth/group.ts";
import { protectedProcedure } from "../../procedures/auth/runtime.ts";
import type { GroupListItem } from "../../types/GroupListItem.ts";

export const groupInvitesRouter = {
  joinAlerts: protectedProcedure.query(async ({ ctx }) =>
    ctx.db.groupJoinAlert.findMany({
      where: {
        recipientId: ctx.session.user.id,
        group: { groupMembers: { some: { userId: ctx.session.user.id } } },
      },
      select: { id: true, memberName: true, createdAt: true, group: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ),
  dismissJoinAlert: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.groupJoinAlert.deleteMany({
        where: { id: input.id, recipientId: ctx.session.user.id },
      });
    }),
  createShared: groupAdminProcedure
    .meta({ rateLimit: { limit: 32, windowMs: 60_000 } })
    .input(z.object({ groupId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const code = randomBytes(16).toString("hex").toUpperCase();
      const expiresAt = new Date(Date.now() + 300_000);
      const invite = await ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
        );
        const actor = await tx.groupMember.findUnique({
          where: { userId_groupId: { userId: ctx.session.user.id, groupId: input.groupId } },
        });
        if (actor?.role !== GroupRole.OWNER && actor?.role !== GroupRole.ADMIN)
          throw new TRPCError({ code: "FORBIDDEN", message: "You are not an admin of this group" });
        return tx.groupSharedInvite.create({
          data: {
            codeHash: createHash("sha256").update(code).digest("hex"),
            groupId: input.groupId,
            expiresAt,
          },
        });
      });
      return {
        id: invite.id,
        code,
        expiresAt,
        expiresInMs: Math.max(0, expiresAt.getTime() - Date.now()),
      };
    }),
  sharedStatuses: groupAdminProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        inviteIds: z.array(z.string().min(1)).min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const invites = await ctx.db.groupSharedInvite.findMany({
        where: { id: { in: input.inviteIds }, groupId: input.groupId },
        select: { id: true, usedAt: true, expiresAt: true },
      });
      return invites.map((invite) => ({
        id: invite.id,
        status: invite.usedAt
          ? ("used" as const)
          : invite.expiresAt <= new Date()
            ? ("expired" as const)
            : ("active" as const),
      }));
    }),
  sharedAcceptanceContext: protectedProcedure
    .meta({
      rateLimit: { limit: 40, ipLimit: 160, namespace: "groupInvites.redeem", windowMs: 60_000 },
    })
    .input(z.object({ code: z.string().regex(/^[A-Fa-f0-9]{32}$/) }))
    .mutation(async ({ ctx, input }) => {
      const invite = await ctx.db.groupSharedInvite.findUnique({
        where: { codeHash: createHash("sha256").update(input.code.toUpperCase()).digest("hex") },
      });
      if (!invite || invite.usedAt || invite.expiresAt <= new Date())
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite is invalid or expired" });
      const member = await ctx.db.groupMember.findUnique({
        where: { userId_groupId: { userId: ctx.session.user.id, groupId: invite.groupId } },
      });
      if (member)
        throw new TRPCError({ code: "CONFLICT", message: "You are already a group member" });
      return getGroupJoinContext({
        db: ctx.db,
        groupId: invite.groupId,
        userId: ctx.session.user.id,
      });
    }),
  acceptShared: protectedProcedure
    .meta({
      rateLimit: { limit: 40, ipLimit: 160, namespace: "groupInvites.redeem", windowMs: 60_000 },
    })
    .input(
      z.object({ code: z.string().regex(/^[A-Fa-f0-9]{32}$/), nextEpoch: groupEpochBundleSchema }),
    )
    .mutation(async ({ ctx, input }) => {
      const codeHash = createHash("sha256").update(input.code.toUpperCase()).digest("hex");
      await ctx.db.$transaction(async (tx) => {
        const invite = await tx.groupSharedInvite.findUnique({ where: { codeHash } });
        if (!invite)
          throw new TRPCError({ code: "NOT_FOUND", message: "Invite is invalid or expired" });
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${invite.groupId} FOR UPDATE`,
        );
        const claimed = await tx.groupSharedInvite.updateMany({
          where: { codeHash, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (claimed.count !== 1)
          throw new TRPCError({ code: "NOT_FOUND", message: "Invite is invalid or expired" });
        const existing = await tx.groupMember.findUnique({
          where: { userId_groupId: { userId: ctx.session.user.id, groupId: invite.groupId } },
        });
        if (existing)
          throw new TRPCError({ code: "CONFLICT", message: "You are already a group member" });
        await tx.groupMember.create({
          data: { groupId: invite.groupId, userId: ctx.session.user.id, role: GroupRole.MEMBER },
        });
        await tx.groupMemberInvite.deleteMany({
          where: { groupId: invite.groupId, recipientId: ctx.session.user.id },
        });
        await persistGroupEpoch({
          db: tx,
          epoch: input.nextEpoch,
          groupId: invite.groupId,
          userId: ctx.session.user.id,
        });
        await createGroupJoinAlerts({
          db: tx,
          groupId: invite.groupId,
          userId: ctx.session.user.id,
        });
      });
      return { message: "Invite accepted." };
    }),
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
        limit: 32,
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

        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${invite.groupId} FOR UPDATE`,
        );

        const currentInvite = await tx.groupMemberInvite.findFirst({
          where: { id: input.inviteId, recipientId: ctx.session.user.id },
        });
        if (!currentInvite) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
        }
        const existing = await tx.groupMember.findUnique({
          where: { userId_groupId: { userId: ctx.session.user.id, groupId: invite.groupId } },
        });
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "You are already a group member" });
        }

        const createdMember = await tx.groupMember.create({
          data: {
            userId: currentInvite.recipientId,
            groupId: currentInvite.groupId,
            role: currentInvite.role,
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
        await createGroupJoinAlerts({
          db: tx,
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
            userId: groupMember.user.id,
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
      await ctx.db.$transaction(async (tx) => {
        const invite = await tx.groupMemberInvite.findFirst({
          where: { id: input.inviteId, recipientId: ctx.session.user.id },
        });
        if (!invite) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
        }
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${invite.groupId} FOR UPDATE`,
        );
        const deleted = await tx.groupMemberInvite.deleteMany({
          where: { id: input.inviteId, recipientId: ctx.session.user.id },
        });
        if (deleted.count !== 1) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
        }
      });

      return {
        message: "Invite declined.",
      };
    }),
  send: groupAdminProcedure
    .meta({
      rateLimit: {
        limit: 240,
        windowMs: 60_000,
      },
    })
    .input(inviteMemberToGroupSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.cache.rateLimits.consume({
        namespace: "groupInvites.send.recipients",
        identifier: { type: "userId", value: ctx.session.user.id },
        limit: 96,
        windowMs: 60_000,
        cost: input.invites.length,
      });
      if (!result.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
      }
      await ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
        );
        const actor = await tx.groupMember.findUnique({
          where: { userId_groupId: { userId: ctx.session.user.id, groupId: input.groupId } },
        });
        if (actor?.role !== GroupRole.OWNER && actor?.role !== GroupRole.ADMIN) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You are not an admin of this group" });
        }
        if (
          actor.role === GroupRole.ADMIN &&
          input.invites.some((invite) => invite.role === GroupRole.ADMIN)
        ) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only owners can invite admins." });
        }
        const users = await tx.user.findMany({
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

        const existingMembers = await tx.groupMember.findMany({
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

        await tx.groupMemberInvite.createMany({
          data: invitesToCreate,
        });
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
