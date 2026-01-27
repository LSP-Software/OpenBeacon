import type { RestManager } from '@discordeno/rest';
import type { Camelize, DiscordMemberWithUser } from '@discordeno/types';
import type { CachedGuildMemberWithUser } from '../types/member';

const MEMBER_FETCH_LIMIT = 1_000;

const buildCachedGuildMember = (member: Camelize<DiscordMemberWithUser>): CachedGuildMemberWithUser | undefined => {
  const memberId = member.user?.id?.toString();
  if (!memberId) return;

  return {
    joinedAt: member.joinedAt ?? undefined,
    roles: member.roles?.map((roleId) => roleId.toString()) ?? [],
    user: {
      id: memberId,
      username: member.user?.username,
      avatar: member.user?.avatar ?? null,
    },
  } satisfies CachedGuildMemberWithUser;
};

export const fetchAllGuildMembers = async ({
  rest,
  guildId,
}: {
  rest: RestManager;
  guildId: string;
}): Promise<CachedGuildMemberWithUser[]> => {
  const members: CachedGuildMemberWithUser[] = [];
  let after: string | undefined;
  let previousAfter: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const chunk = await rest
      .getMembers(guildId, {
        limit: MEMBER_FETCH_LIMIT,
        after,
      })
      .catch((error) => {
        console.error(`Failed to fetch members for guild ${guildId}`, JSON.stringify(error));
        return [] as Camelize<DiscordMemberWithUser>[];
      });

    if (!chunk.length) break;

    const sanitizedMembers = chunk
      .map((member) => buildCachedGuildMember(member))
      .filter((member): member is CachedGuildMemberWithUser => Boolean(member));

    if (sanitizedMembers.length) {
      members.push(...sanitizedMembers);
    }

    const lastMemberWithUser = [...chunk].reverse().find((member) => member.user?.id);
    after = lastMemberWithUser?.user?.id?.toString();

    if (!after || after === previousAfter || chunk.length < MEMBER_FETCH_LIMIT) {
      hasMore = false;
    }

    previousAfter = after;
  }

  return members;
};
