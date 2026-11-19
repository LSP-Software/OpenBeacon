import { logRateLimit } from "@openbeacon/shared";
import { createHash, randomBytes } from "node:crypto";
import { GroupEventType, GroupRole, Prisma, readDatabaseTime } from "@openbeacon/database";
import {
  groupEpochBundleSchema,
  historyShareSchema,
  inviteMemberToGroupSchema,
} from "@openbeacon/schemas";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import {
  getGroupJoinContext,
  getInviteAcceptanceContext,
  persistGroupEpoch,
} from "../../lib/groupEpochs.ts";
import { emailInviteCreatedAfter } from "../../lib/emailInvites.ts";
import { assertAccountBelowGroupLimit } from "../../lib/groupLimit.ts";
import { limits } from "../../lib/limits.ts";
import {
  assertRoomToInvite,
  assertRoomToJoin,
  groupFullError,
  groupSeatState,
  lockOwnerThenGroup,
  noFreeSeatsToInviteMessage,
} from "../../lib/seats.ts";
import { groupEditorProcedure } from "../../procedures/auth/group.ts";
import { protectedProcedure } from "../../procedures/auth/runtime.ts";
import { imageKeySelect, toStoredImageKey } from "../../lib/imageKeys.ts";
import type { GroupListItem } from "../../types/GroupListItem.ts";
import {
  isAdminOrEditor,
  notAdminOrEditorError,
  visibleOwnershipOffer,
} from "../../lib/groupRoles.ts";

const creatorCanAdmit = async (
  db: Pick<Prisma.TransactionClient, "groupMember">,
  invite: { creatorId: string | null; groupId: string },
) => {
  if (!invite.creatorId) return false;
  const creator = await db.groupMember.findUnique({
    where: { userId_groupId: { userId: invite.creatorId, groupId: invite.groupId } },
    select: { role: true, user: { select: { pendingDeletion: true } } },
  });
  return !creator?.user.pendingDeletion && isAdminOrEditor(creator?.role);
};

const sharedCodeHash = (code: string) =>
  createHash("sha256").update(code.toUpperCase()).digest("hex");

const findRedeemableSharedInvite = async (
  db: Pick<Prisma.TransactionClient, "groupMember" | "groupSharedInvite">,
  code: string,
) => {
  const invite = await db.groupSharedInvite.findUnique({
    where: { codeHash: sharedCodeHash(code) },
    include: { creator: { select: { name: true } } },
  });
  if (
    !invite?.creator ||
    invite.usedAt ||
    invite.expiresAt <= new Date() ||
    !(await creatorCanAdmit(db, invite))
  )
    throw new TRPCError({ code: "NOT_FOUND", message: "Invite is invalid or expired" });
  return { groupId: invite.groupId, creator: invite.creator };
};

const getInvitePreview = async ({
  db,
  groupId,
  inviter,
  notFoundMessage,
  selfHosted,
  userId,
}: {
  db: Pick<Prisma.TransactionClient, "$queryRaw" | "group" | "groupMember" | "user">;
  groupId: string;
  inviter: { name: string };
  notFoundMessage: string;
  selfHosted: boolean;
  userId: string;
}) => {
  const [group, member, user, groupCount] = await Promise.all([
    db.group.findUnique({
      where: { id: groupId },
      select: { id: true, name: true, _count: { select: { groupMembers: true } } },
    }),
    db.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      select: { id: true },
    }),
    db.user.findUnique({ where: { id: userId }, select: { pendingDeletion: true } }),
    db.groupMember.count({ where: { userId } }),
  ]);
  if (!group) throw new TRPCError({ code: "NOT_FOUND", message: notFoundMessage });
  const alreadyMember = member !== null;
  const seats = await groupSeatState({ db, groupId, joinerId: userId, selfHosted });
  return {
    group: {
      id: group.id,
      name: group.name,
      image: null,
      memberCount: group._count.groupMembers,
    },
    inviter: { name: inviter.name, image: null },
    owner: { name: seats.owner.name },
    seats: { needed: seats.needed, perGroup: limits.peoplePerGroup },
    alreadyMember,
    joinBlockedBy: alreadyMember
      ? null
      : !user || user.pendingDeletion
        ? ("PENDING_DELETION" as const)
        : groupCount >= limits.groupsPerAccount
          ? ("GROUP_LIMIT" as const)
          : seats.blockedBy,
  };
};

export const groupInvitesRouter = {
  joinAlerts: protectedProcedure.query(
    (): Array<{ id: string; memberName: string; createdAt: Date; group: { name: string } }> => [],
  ),
  dismissJoinAlert: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(128) }))
    .mutation(() => {}),
  createShared: groupEditorProcedure
    .meta({ rateLimit: { limit: 32, windowMs: 60_000 } })
    .input(z.object({ groupId: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const code = randomBytes(16).toString("hex").toUpperCase();
      const expiresAt = new Date(Date.now() + 300_000);
      const invite = await ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
        );
        const actor = await tx.groupMember.findUnique({
          where: { userId_groupId: { userId: ctx.session.user.id, groupId: input.groupId } },
          include: { user: { select: { pendingDeletion: true } } },
        });
        if (actor?.user.pendingDeletion || !isAdminOrEditor(actor?.role)) {
          throw notAdminOrEditorError();
        }
        await assertRoomToInvite({
          db: tx,
          groupId: input.groupId,
          selfHosted: ctx.selfHosted,
          userId: ctx.session.user.id,
        });
        return tx.groupSharedInvite.create({
          data: {
            codeHash: createHash("sha256").update(code).digest("hex"),
            creatorId: ctx.session.user.id,
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
  seats: groupEditorProcedure.query(async ({ ctx, input }) => {
    const state = await groupSeatState({
      db: ctx.db,
      groupId: input.groupId,
      selfHosted: ctx.selfHosted,
    });
    return {
      blockedBy: state.blockedBy,
      message:
        state.blockedBy === "GROUP_FULL"
          ? groupFullError().message
          : state.blockedBy === "NO_FREE_SEATS"
            ? noFreeSeatsToInviteMessage({ ...state, userId: ctx.session.user.id })
            : null,
    };
  }),
  sharedStatuses: groupEditorProcedure
    .input(
      z.object({
        groupId: z.string().min(1).max(128),
        inviteIds: z.array(z.string().min(1).max(128)).min(1).max(500),
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
      rateLimit: { limit: 40, namespace: "groupInvites.redeem", windowMs: 60_000 },
    })
    .input(z.object({ code: z.string().regex(/^[A-Fa-f0-9]{32}$/) }))
    .mutation(async ({ ctx, input }) => {
      const invite = await findRedeemableSharedInvite(ctx.db, input.code);
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
  sharedPreview: protectedProcedure
    .meta({
      rateLimit: { limit: 40, namespace: "groupInvites.redeem", windowMs: 60_000 },
    })
    .input(z.object({ code: z.string().regex(/^[A-Fa-f0-9]{32}$/) }))
    .mutation(async ({ ctx, input }) => {
      const invite = await findRedeemableSharedInvite(ctx.db, input.code);
      return getInvitePreview({
        db: ctx.db,
        groupId: invite.groupId,
        inviter: invite.creator,
        notFoundMessage: "Invite is invalid or expired",
        selfHosted: ctx.selfHosted,
        userId: ctx.session.user.id,
      });
    }),
  acceptShared: protectedProcedure
    .meta({
      rateLimit: { limit: 40, namespace: "groupInvites.redeem", windowMs: 60_000 },
    })
    .input(
      z.object({
        code: z.string().regex(/^[A-Fa-f0-9]{32}$/),
        nextEpoch: groupEpochBundleSchema,
        historyShare: historyShareSchema.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const codeHash = sharedCodeHash(input.code);
      const notFound = () =>
        new TRPCError({ code: "NOT_FOUND", message: "Invite is invalid or expired" });
      const joinEventId = await ctx.db.$transaction(async (tx) => {
        const invite = await tx.groupSharedInvite.findUnique({ where: { codeHash } });
        if (!invite) throw notFound();
        return joinGroup(tx, {
          ...input,
          deviceId: ctx.deviceId,
          groupId: invite.groupId,
          notFound,
          selfHosted: ctx.selfHosted,
          userId: ctx.session.user.id,
          claimInvite: async () => {
            if (!(await creatorCanAdmit(tx, invite))) throw notFound();
            const claimed = await tx.groupSharedInvite.updateMany({
              where: { codeHash, usedAt: null, expiresAt: { gt: new Date() } },
              data: { usedAt: new Date() },
            });
            if (claimed.count !== 1) throw notFound();
            return GroupRole.MEMBER;
          },
        });
      });
      ctx.push?.groupEvents([joinEventId]);
      return { message: "Invite accepted." };
    }),
  preview: protectedProcedure
    .input(z.object({ inviteId: z.string().min(1).max(128) }))
    .query(async ({ ctx, input }) => {
      const invite = await ctx.db.groupMemberInvite.findFirst({
        where: {
          id: input.inviteId,
          recipientId: ctx.session.user.id,
          createdAt: { gt: emailInviteCreatedAfter() },
        },
        select: { groupId: true, inviter: { select: { name: true } } },
      });
      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      return getInvitePreview({
        db: ctx.db,
        groupId: invite.groupId,
        inviter: invite.inviter,
        notFoundMessage: "Invite not found",
        selfHosted: ctx.selfHosted,
        userId: ctx.session.user.id,
      });
    }),
  acceptanceContext: protectedProcedure
    .input(z.object({ inviteId: z.string().min(1).max(128) }))
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
        inviteId: z.string().min(1).max(128),
        nextEpoch: groupEpochBundleSchema,
        historyShare: historyShareSchema.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      const openInvite = (db: Pick<Prisma.TransactionClient, "groupMemberInvite">) =>
        db.groupMemberInvite.findFirst({
          where: {
            id: input.inviteId,
            recipientId: ctx.session.user.id,
            createdAt: { gt: emailInviteCreatedAfter() },
          },
        });
      const joined = await ctx.db.$transaction(async (tx) => {
        const invite = await openInvite(tx);
        if (!invite) throw notFound();
        const joinEventId = await joinGroup(tx, {
          ...input,
          deviceId: ctx.deviceId,
          groupId: invite.groupId,
          notFound,
          selfHosted: ctx.selfHosted,
          userId: ctx.session.user.id,
          claimInvite: async () => {
            const current = await openInvite(tx);
            if (!current) throw notFound();
            return current.role;
          },
        });
        const group = await tx.group.findUniqueOrThrow({
          where: { id: invite.groupId },
          select: {
            id: true,
            name: true,
            image: true,
            ownerId: true,
            ownershipOfferedToId: true,
            ...imageKeySelect,
            groupMembers: {
              select: {
                id: true,
                role: true,
                ...imageKeySelect,
                user: { select: { id: true, name: true, image: true } },
              },
            },
          },
        });
        return { group, joinEventId };
      });
      ctx.push?.groupEvents([joined.joinEventId]);
      const { group } = joined;

      return {
        message: "Invite accepted.",
        group: {
          id: group.id,
          name: group.name,
          image: group.image,
          imageKey: toStoredImageKey(group),
          ownerId: group.ownerId,
          ownershipOfferedToId: visibleOwnershipOffer(group, ctx.session.user.id),
          onHold: false,
          members: group.groupMembers.map((groupMember) => ({
            id: groupMember.id,
            userId: groupMember.user.id,
            name: groupMember.user.name,
            image: groupMember.user.image,
            imageKey: toStoredImageKey(groupMember),
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
    .input(z.object({ inviteId: z.string().min(1).max(128) }))
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
  send: groupEditorProcedure
    .meta({
      rateLimit: {
        limit: 240,
        windowMs: 60_000,
      },
    })
    .input(inviteMemberToGroupSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.cache.rateLimits.consume(
        {
          namespace: "groupInvites.send.recipients",
          identifier: { type: "userId", value: ctx.session.user.id },
          limit: 96,
          windowMs: 60_000,
          cost: input.invites.length,
        },
        { whenUnavailable: "allow" },
      );
      if (!result.allowed) {
        logRateLimit({ path: "groupInvites.send.recipients", scope: "userId" });
        throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
      }
      await ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
        );
        const actor = await tx.groupMember.findUnique({
          where: { userId_groupId: { userId: ctx.session.user.id, groupId: input.groupId } },
          include: { user: { select: { pendingDeletion: true } } },
        });
        if (!actor || actor.user.pendingDeletion || !isAdminOrEditor(actor.role)) {
          throw notAdminOrEditorError();
        }
        if (
          actor.role === GroupRole.EDITOR &&
          input.invites.some((invite) => invite.role === GroupRole.EDITOR)
        ) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only Admins can invite Editors." });
        }
        await assertRoomToInvite({
          db: tx,
          groupId: input.groupId,
          selfHosted: ctx.selfHosted,
          userId: ctx.session.user.id,
        });
        await tx.groupMemberInvite.deleteMany({
          where: { groupId: input.groupId, createdAt: { lte: emailInviteCreatedAfter() } },
        });
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

        const invitesToSend = users
          .map((user) => {
            if (user.id === ctx.session.user.id) return undefined;

            if (existingMemberIds.has(user.id)) return undefined;

            const invite = input.invites.find((invite) => invite.email === user.email);
            if (!invite) return undefined;

            return {
              existingInviteId: user.receivedGroupMemberInvites[0]?.id,
              recipientId: user.id,
              role: invite.role,
            };
          })
          .filter((invite) => invite !== undefined);

        const now = new Date();
        const invitesToCreate = [];
        for (const invite of invitesToSend) {
          const refreshed = invite.existingInviteId
            ? await tx.groupMemberInvite.updateMany({
                where: { id: invite.existingInviteId },
                data: { createdAt: now, inviterId: ctx.session.user.id, role: invite.role },
              })
            : undefined;
          if (refreshed?.count === 1) continue;
          invitesToCreate.push({
            inviterId: ctx.session.user.id,
            recipientId: invite.recipientId,
            groupId: input.groupId,
            role: invite.role,
          });
        }

        await tx.groupMemberInvite.createMany({ data: invitesToCreate });
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
        createdAt: { gt: emailInviteCreatedAfter() },
      },
      include: {
        inviter: { select: { name: true } },
        group: { select: { name: true } },
      },
    });

    return invites.map((invite) => ({
      id: invite.id,
      inviter: {
        id: invite.inviterId,
        name: invite.inviter.name,
        image: null,
      },
      group: {
        id: invite.groupId,
        name: invite.group.name,
        image: null,
      },
    }));
  }),
} satisfies TRPCRouterRecord;

const assertAccountCanJoinGroup = async (tx: Prisma.TransactionClient, userId: string) => {
  const [user] = await tx.$queryRaw<Array<{ pendingDeletion: boolean }>>(
    Prisma.sql`SELECT "pendingDeletion" FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`,
  );
  if (!user || user.pendingDeletion) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "An account pending deletion cannot join a group.",
    });
  }
};

const joinGroup = async (
  tx: Prisma.TransactionClient,
  {
    claimInvite,
    deviceId,
    groupId,
    historyShare,
    nextEpoch,
    notFound,
    selfHosted,
    userId,
  }: {
    claimInvite: () => Promise<GroupRole>;
    deviceId: string;
    groupId: string;
    historyShare?: z.infer<typeof historyShareSchema> | null | undefined;
    nextEpoch: z.infer<typeof groupEpochBundleSchema>;
    notFound: () => TRPCError;
    selfHosted: boolean;
    userId: string;
  },
) => {
  const ownerId = await lockOwnerThenGroup({ db: tx, groupId, userIds: [userId] });
  await assertAccountCanJoinGroup(tx, userId);
  if (!ownerId) throw notFound();
  const role = await claimInvite();
  const existing = await tx.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  if (existing)
    throw new TRPCError({ code: "CONFLICT", message: "You are already a group member" });
  await assertAccountBelowGroupLimit(tx, userId);
  await assertRoomToJoin({ db: tx, groupId, joinerId: userId, selfHosted });
  const joined = await tx.groupMember.create({
    data: {
      groupId,
      joinedEpochNumber: nextEpoch.epochNumber,
      role,
      userId,
      historyShare: historyShare ?? null,
      createdAt: await readDatabaseTime(tx),
    },
    select: { createdAt: true },
  });
  await tx.groupMemberInvite.deleteMany({ where: { groupId, recipientId: userId } });
  await persistGroupEpoch({ db: tx, deviceId, epoch: nextEpoch, groupId, userId });
  const event = await tx.groupEvent.create({
    data: {
      groupId,
      type: GroupEventType.MEMBER_JOINED,
      subjectUserId: userId,
      role,
      createdAt: joined.createdAt,
    },
    select: { id: true },
  });
  return event.id;
};
