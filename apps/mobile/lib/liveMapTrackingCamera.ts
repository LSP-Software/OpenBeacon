export const buildLiveMapTrackingCameraStop = ({
  followSuspended,
  latitude,
  longitude,
  padding,
  previousLatitude,
  previousLongitude,
  previouslyTrackedDeviceId,
  selectedDeviceId,
}: {
  followSuspended: boolean;
  latitude: number;
  longitude: number;
  padding: {
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
    paddingTop: number;
  };
  previousLatitude: number | null;
  previousLongitude: number | null;
  previouslyTrackedDeviceId: string | null;
  selectedDeviceId: string;
}) => {
  const isNewFocus = previouslyTrackedDeviceId !== selectedDeviceId;

  if (followSuspended && !isNewFocus) {
    return null;
  }

  if (!isNewFocus && previousLatitude === latitude && previousLongitude === longitude) {
    return null;
  }

  if (isNewFocus) {
    return {
      animationDuration: 500,
      animationMode: "flyTo" as const,
      centerCoordinate: [longitude, latitude] as [number, number],
      padding,
      zoomLevel: 15 as const,
    };
  }

  return {
    animationDuration: 400,
    animationMode: "easeTo" as const,
    centerCoordinate: [longitude, latitude] as [number, number],
    padding,
  };
};

export const shouldSuspendLiveMapFollowOnRegionChange = ({
  animated,
  isUserInteraction,
  nowMs,
  suppressUserCameraControlUntilMs,
}: {
  animated: boolean;
  isUserInteraction: boolean;
  nowMs: number;
  suppressUserCameraControlUntilMs: number;
}) => {
  if (!isUserInteraction) {
    return false;
  }

  if (animated && nowMs < suppressUserCameraControlUntilMs) {
    return false;
  }

  return true;
};
