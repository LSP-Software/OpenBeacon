type DriveAlertMute = { mutedUserId: string | null };

export const driveMuteState = ({
  memberUserIds,
  mutes,
  nameOf,
  quietUserIds,
}: {
  memberUserIds: readonly string[];
  mutes: readonly DriveAlertMute[];
  nameOf: (userId: string) => string;
  quietUserIds: readonly string[];
}) => {
  const everyoneMuted = mutes.some((mute) => mute.mutedUserId === null);
  const mutedUserIds = new Set(mutes.map((mute) => mute.mutedUserId));
  const members = memberUserIds.map((userId) => ({
    userId,
    alertsOn: !everyoneMuted && !mutedUserIds.has(userId) && !quietUserIds.includes(userId),
    sendsAlerts: !quietUserIds.includes(userId),
  }));
  const muted = members.filter((member) => member.sendsAlerts && !member.alertsOn);
  const [onlyMuted] = muted;
  return {
    everyoneMuted,
    members,
    summary: everyoneMuted
      ? "Everyone muted"
      : onlyMuted === undefined
        ? "Alerts on for everyone"
        : muted.length === 1
          ? `Muted for ${nameOf(onlyMuted.userId)}`
          : `Muted for ${muted.length} people`,
  };
};

export const applyDriveMuteChange = (
  mutes: readonly DriveAlertMute[],
  change: DriveAlertMute & { muted: boolean },
): DriveAlertMute[] => {
  const others = mutes.filter((mute) => mute.mutedUserId !== change.mutedUserId);
  return change.muted ? [...others, { mutedUserId: change.mutedUserId }] : others;
};
