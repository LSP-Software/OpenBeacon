export const buildLiveMapTrackingCameraStop = ({
  followSuspended,
  latitude,
  longitude,
  padding,
  previousLatitude,
  previousLongitude,
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
  const isNewFocus = previouslyTrackedUserId !== selectedUserId;

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
