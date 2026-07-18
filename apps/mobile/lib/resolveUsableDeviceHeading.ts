export const resolveUsableDeviceHeading = (heading: {
  accuracy: number;
  magHeading: number;
  trueHeading: number;
}): number | null => {
  if (heading.accuracy < 2) {
    return null;
  }

  const raw =
    heading.trueHeading >= 0
      ? heading.trueHeading
      : heading.magHeading === -1
        ? null
        : heading.magHeading;

  if (raw === null || !Number.isFinite(raw)) {
    return null;
  }

  return ((raw % 360) + 360) % 360;
};
