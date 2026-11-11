export const nextMapMarkerSelection = (
  currentSelectedDeviceId: string | null,
  tappedDeviceId: string | null,
) => {
  if (tappedDeviceId === null) {
    return null;
  }

  if (currentSelectedDeviceId === tappedDeviceId) {
    return null;
  }

  return tappedDeviceId;
};
