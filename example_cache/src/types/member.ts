export interface CachedMember {
  id: string;
  name: string;
  roleIds: string[];
  avatar: string | undefined | null;
}

export interface CachedGuildMemberWithUser {
  joinedAt?: string;
  roles: string[];
  user?: {
    id: string;
    username?: string;
    avatar?: string | null;
  };
}
