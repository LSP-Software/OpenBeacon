import type { RouterOutputs } from "./api.ts";

type PlaceAlertMute = RouterOutputs["placeAlerts"]["mutes"]["mutes"][number];

export type PlaceAlertMuteChange = PlaceAlertMute & { muted: boolean };

export const isEveryoneMuted = (mutes: readonly PlaceAlertMute[], placeId: string) =>
  mutes.some((mute) => mute.placeId === placeId && mute.mutedUserId === null);

export const placeMuteState = ({
  memberUserIds,
  mutes,
  placeId,
}: {
  memberUserIds: readonly string[];
  mutes: readonly PlaceAlertMute[];
  placeId: string;
}) => {
  const forPlace = mutes.filter((mute) => mute.placeId === placeId);
  const everyoneMuted = isEveryoneMuted(forPlace, placeId);
  const mutedUserIds = new Set(forPlace.map((mute) => mute.mutedUserId));
  const members = memberUserIds.map((userId) => ({
    userId,
    alertsOn: !everyoneMuted && !mutedUserIds.has(userId),
  }));
  const mutedCount = members.filter((member) => !member.alertsOn).length;
  return {
    everyoneMuted,
    members,
    summary: everyoneMuted
      ? "Everyone muted"
      : mutedCount === 0
        ? "Alerts on for everyone"
        : `${mutedCount} muted`,
  };
};

export const applyMuteChange = (
  mutes: readonly PlaceAlertMute[],
  change: PlaceAlertMuteChange,
): PlaceAlertMute[] => {
  const others = mutes.filter(
    (mute) => mute.placeId !== change.placeId || mute.mutedUserId !== change.mutedUserId,
  );
  return change.muted
    ? [...others, { placeId: change.placeId, mutedUserId: change.mutedUserId }]
    : others;
};
