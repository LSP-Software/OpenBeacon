export type InviteToConfirm = { kind: "code"; code: string } | { kind: "email"; inviteId: string };
