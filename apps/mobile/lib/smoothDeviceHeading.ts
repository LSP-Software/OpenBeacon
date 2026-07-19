export const HEADING_SAMPLE_SMOOTHING_ALPHA = 0.22;
export const HEADING_CHASE_SPEED = 7;

const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

export const shortestHeadingDelta = (fromDegrees: number, toDegrees: number) =>
  ((toDegrees - fromDegrees + 540) % 360) - 180;

export const smoothHeadingSample = (smoothed: number | null, sample: number | null) => {
  if (sample === null) {
    return null;
  }

  if (smoothed === null) {
    return sample;
  }

  return normalizeDegrees(
    smoothed + shortestHeadingDelta(smoothed, sample) * HEADING_SAMPLE_SMOOTHING_ALPHA,
  );
};

export const chaseHeadingToward = (
  displayed: number | null,
  target: number | null,
  dtSeconds: number,
) => {
  if (target === null) {
    return null;
  }

  if (displayed === null) {
    return target;
  }

  const delta = shortestHeadingDelta(displayed, target);
  const factor = 1 - Math.exp(-HEADING_CHASE_SPEED * Math.max(0, dtSeconds));
  return normalizeDegrees(displayed + delta * factor);
};

export const quantizeHeadingDegrees = (degrees: number) => Math.round(degrees * 10) / 10;
