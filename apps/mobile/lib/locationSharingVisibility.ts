import type { GroupDeviceSharingState } from "@openbeacon/shared";

export const canShowSharedLocation = (
  location: { deviceId: string },
  sharing: readonly GroupDeviceSharingState[] | undefined,
) => {
  const device = sharing?.find((item) => item.deviceId === location.deviceId);
  return !device?.paused && !device?.onHold;
};
