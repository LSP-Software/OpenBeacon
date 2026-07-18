export const buildLiveMapTrackingCameraStop = ({
  latitude,
  longitude,
  padding,
  previouslyTrackedUserId,
  selectedUserId,
}: {
  latitude: number;
  longitude: number;
  padding: {
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
    paddingTop: number;
  };
  previouslyTrackedUserId: string | null;
  selectedUserId: string;
}) => {
  const isNewFocus = previouslyTrackedUserId !== selectedUserId;

  return {
    animationDuration: isNewFocus ? 500 : 400,
    animationMode: isNewFocus ? ("flyTo" as const) : ("easeTo" as const),
    centerCoordinate: [longitude, latitude] as [number, number],
    padding,
    zoomLevel: 15 as const,
  };
};
