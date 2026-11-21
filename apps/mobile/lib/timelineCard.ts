export const timelineCardOpens = ({
  progress,
  velocity,
}: {
  progress: number;
  velocity: number;
}) => (Math.abs(velocity) > 0.3 ? velocity < 0 : progress > 0.5);
