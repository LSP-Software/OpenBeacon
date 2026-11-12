import type { DeviceSharingState } from "@openbeacon/shared";

export const canShowSharedLocation = (
  location: { deviceId: string; timestamp: string | null },
  sharing: readonly DeviceSharingState[] | undefined,
) => {
  const state = sharing?.find((device) => device.deviceId === location.deviceId);
  if (!state) return true;
  if (state.paused) return false;
  return (
    state.resumeAfter === null ||
    (location.timestamp !== null && Date.parse(location.timestamp) > state.resumeAfter.getTime())
  );
};
