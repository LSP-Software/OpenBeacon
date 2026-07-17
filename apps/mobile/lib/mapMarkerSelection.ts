export const nextMapMarkerSelection = (
  currentSelectedUserId: string | null,
  tappedUserId: string | null,
) => {
  if (tappedUserId === null) {
    return null;
  }

  if (currentSelectedUserId === tappedUserId) {
    return null;
  }

  return tappedUserId;
};
