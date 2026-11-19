export type InviteToConfirm = { kind: "code"; code: string } | { kind: "email"; inviteId: string };

export type JoinInvite = { code: string; server: string | null };

export type ReadInvite = { invite: JoinInvite; error: null } | { invite: null; error: string };
