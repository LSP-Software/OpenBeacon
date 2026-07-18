import type { LiveMapPosition } from "./mapTrackingTypes.ts";

export const buildMemberLiveStatuses = ({
  members,
  positions,
}: {
  members: readonly {
    id: string;
    role: string;
    user: {
      id: string;
      image: string | null;
      name: string;
    };
  }[];
  positions: readonly LiveMapPosition[];
}) => {
  const positionByUserId = new Map(positions.map((position) => [position.userId, position]));

  return members.map((member) => {
    const live = positionByUserId.get(member.user.id);

    return {
      battery: live?.battery ?? null,
      id: member.id,
      role: member.role,
      timestamp: live?.timestamp ?? null,
      user: member.user,
    };
  });
};
