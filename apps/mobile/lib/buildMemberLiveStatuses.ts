import type { MapMemberDevice } from "./mapPeopleTypes.ts";
import type { LiveMapPosition } from "./mapTrackingTypes.ts";

export const buildMemberLiveStatuses = ({
  memberDevices = [],
  members,
  positions,
}: {
  memberDevices?: readonly MapMemberDevice[];
  members: readonly {
    id: string;
    role: string;
    nickname?: string | null;
    user: {
      id: string;
      image: string | null;
      name: string;
    };
  }[];
  positions: readonly LiveMapPosition[];
}) =>
  members.map((member) => {
    const devices = positions
      .filter((position) => position.userId === member.user.id)
      .sort((first, second) => second.timestamp.localeCompare(first.timestamp))
      .map((position) => {
        const device = memberDevices.find((item) => item.deviceId === position.deviceId);
        return {
          battery: position.battery,
          deviceId: position.deviceId,
          icon: device?.icon ?? null,
          name: device?.name ?? null,
          timestamp: position.timestamp,
        };
      });
    const newest = devices[0];

    return {
      activeDeviceCount: memberDevices.filter((device) => device.userId === member.user.id).length,
      battery: newest?.battery ?? null,
      devices,
      id: member.id,
      role: member.role,
      nickname: member.nickname ?? null,
      timestamp: newest?.timestamp ?? null,
      user: member.user,
    };
  });
