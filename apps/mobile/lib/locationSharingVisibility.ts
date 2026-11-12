import type { GroupDeviceSharingState } from "@openbeacon/shared";

export const canShowSharedLocation = (
  location: { deviceId: string },
  sharing: readonly GroupDeviceSharingState[] | undefined,
) => !sharing?.find((device) => device.deviceId === location.deviceId)?.paused;
