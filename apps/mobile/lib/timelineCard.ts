export type TimelineCardBox = { height: number; width: number; x: number; y: number };

export const timelineCardOpens = ({
  progress,
  velocity,
}: {
  progress: number;
  velocity: number;
}) => (Math.abs(velocity) > 0.3 ? velocity < 0 : progress > 0.5);

export const timelineCardIsOpen = ({
  canCollapse,
  expanded,
  loading,
}: {
  canCollapse: boolean;
  expanded: boolean;
  loading: boolean;
}) => expanded || (!canCollapse && !loading);

export const timelineCardShift = ({
  from,
  to,
}: {
  from: ReadonlyArray<TimelineCardBox | undefined>;
  to: ReadonlyArray<TimelineCardBox | undefined>;
}) => {
  const start = centreOf(from);
  const end = centreOf(to);
  if (!start || !end) return { scale: 1, x: 0, y: 0 };
  return { scale: end.width / start.width, x: end.x - start.x, y: end.y - start.y };
};

export const timelineMiniClockScale = ({
  available,
  width,
}: {
  available: number;
  width: number;
}) => (available > 0 && width > 0 ? Math.min(0.8, available / width) : 0.8);

export const timelineCardBoxMoved = (current: TimelineCardBox | undefined, next: TimelineCardBox) =>
  !current ||
  Math.abs(current.height - next.height) >= 0.5 ||
  Math.abs(current.width - next.width) >= 0.5 ||
  Math.abs(current.x - next.x) >= 0.5 ||
  Math.abs(current.y - next.y) >= 0.5;

const centreOf = (chain: ReadonlyArray<TimelineCardBox | undefined>) => {
  const boxes = chain.filter((box) => box !== undefined);
  const last = boxes.at(-1);
  if (!last || boxes.length !== chain.length || last.width <= 0) return null;
  return {
    width: last.width,
    x: boxes.reduce((total, box) => total + box.x, 0) + last.width / 2,
    y: boxes.reduce((total, box) => total + box.y, 0) + last.height / 2,
  };
};
