export const buildLiveMapTrackingCameraStop = ({
  latitude,
  longitude,
  padding,
  previouslyTrackedUserId,
  selectedUserId,
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
  previouslyTrackedUserId: string | null;
  selectedUserId: string;
}) => {
  if (previouslyTrackedUserId === selectedUserId) {
    return null;
  }

  return {
    animationDuration: 500,
    animationMode: "flyTo" as const,
    centerCoordinate: [longitude, latitude] as [number, number],
    padding,
    zoomLevel: 15 as const,
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
