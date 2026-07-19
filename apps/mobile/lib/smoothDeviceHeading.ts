export const HEADING_SAMPLE_SMOOTHING_ALPHA = 0.22;
export const HEADING_CHASE_SPEED = 7;
export const HEADING_PUBLISH_INTERVAL_MS = 50;
export const HEADING_SETTLED_DEGREES = 0.2;

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

export const isHeadingChaseSettled = (displayed: number | null, target: number | null) =>
  displayed !== null &&
  target !== null &&
  Math.abs(shortestHeadingDelta(displayed, target)) < HEADING_SETTLED_DEGREES;

export const resolvePublishedHeading = ({
  displayed,
  force = false,
  lastPublishAt,
  now,
  published,
}: {
  displayed: number | null;
  force?: boolean;
  lastPublishAt: number;
  now: number;
  published: number | null;
}) => {
  const nextPublished = displayed === null ? null : quantizeHeadingDegrees(displayed);

  if (nextPublished === published) {
    return { lastPublishAt, published };
  }

  if (!force && nextPublished !== null && now - lastPublishAt < HEADING_PUBLISH_INTERVAL_MS) {
    return { lastPublishAt, published };
  }

  return {
    lastPublishAt: now,
    published: nextPublished,
  };
};
