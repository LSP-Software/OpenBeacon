import { MAP_CONTROL_CLEARANCE, MAP_EDGE_INSET } from "./mapEdgePoint.ts";

export const spaceMapEdgePoints = ({
  controls,
  height,
  occupied = [],
  points,
  previous = [],
  width,
}: {
  controls: { x: number; y: number; width: number; height: number } | null;
  height: number;
  occupied?: readonly { x: number; y: number }[];
  points: readonly { userId: string; x: number; y: number; angle: number }[];
  previous?: readonly { userId: string; x: number; y: number }[];
  width: number;
}) => {
  const placed: Array<{ userId: string; x: number; y: number; angle: number }> = [];
  for (const point of points) {
    const obstacles = [...occupied, ...placed];
    const prior = previous.find((item) => item.userId === point.userId);
    const blocked =
      prior &&
      occupied.some((other) => {
        const dx = prior.x - point.x;
        const dy = prior.y - point.y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared === 0) return false;
        const progress = Math.max(
          0,
          Math.min(1, ((other.x - point.x) * dx + (other.y - point.y) * dy) / lengthSquared),
        );
        return (
          Math.hypot(other.x - point.x - progress * dx, other.y - point.y - progress * dy) < 52
        );
      });
    const controlLeft = controls ? controls.x - MAP_CONTROL_CLEARANCE : null;
    const vertical =
      point.x === MAP_EDGE_INSET ||
      point.x === width - MAP_EDGE_INSET ||
      (controlLeft !== null && point.x === controlLeft);
    const horizontal = point.y === MAP_EDGE_INSET || point.y === height - MAP_EDGE_INSET;
    if (vertical || horizontal) {
      let offset = 0;
      for (const other of placed) {
        const source = points.find((item) => item.userId === other.userId);
        if (!source || (vertical ? source.x !== point.x : source.y !== point.y)) continue;
        const distance = Math.abs(vertical ? point.y - other.y : point.x - other.x);
        const otherOffset = Math.abs(vertical ? other.x - point.x : other.y - point.y);
        if (distance < 52) {
          offset = Math.max(offset, otherOffset + Math.sqrt(52 * 52 - distance * distance));
        } else if (distance < 104) {
          const progress = (distance - 52) / 52;
          offset = Math.max(offset, otherOffset * (1 - progress * progress * (3 - 2 * progress)));
        }
      }
      const candidate = vertical
        ? { x: point.x + (point.x === MAP_EDGE_INSET ? offset : -offset), y: point.y }
        : { x: point.x, y: point.y + (point.y === MAP_EDGE_INSET ? offset : -offset) };
      if (
        !blocked &&
        candidate.x >= MAP_EDGE_INSET &&
        candidate.x <= width - MAP_EDGE_INSET &&
        candidate.y >= MAP_EDGE_INSET &&
        candidate.y <= height - MAP_EDGE_INSET &&
        !(
          controls &&
          candidate.x > controls.x - MAP_CONTROL_CLEARANCE &&
          candidate.x < controls.x + controls.width + MAP_CONTROL_CLEARANCE &&
          candidate.y > controls.y - MAP_CONTROL_CLEARANCE &&
          candidate.y < controls.y + controls.height + MAP_CONTROL_CLEARANCE
        ) &&
        obstacles.every(
          (other) => Math.hypot(candidate.x - other.x, candidate.y - other.y) >= 51.999,
        )
      ) {
        placed.push({ ...point, ...candidate });
        continue;
      }
    }
    if (
      !blocked &&
      obstacles.every((other) => Math.hypot(point.x - other.x, point.y - other.y) >= 52)
    ) {
      placed.push(point);
      continue;
    }
    const xCandidates = [point.x, MAP_EDGE_INSET, width - MAP_EDGE_INSET];
    const yCandidates = [point.y, MAP_EDGE_INSET, height - MAP_EDGE_INSET];
    if (prior) {
      xCandidates.push(prior.x);
      yCandidates.push(prior.y);
    }
    if (controls) {
      xCandidates.push(
        controls.x - MAP_CONTROL_CLEARANCE,
        controls.x + controls.width + MAP_CONTROL_CLEARANCE,
      );
      yCandidates.push(
        controls.y - MAP_CONTROL_CLEARANCE,
        controls.y + controls.height + MAP_CONTROL_CLEARANCE,
      );
    }
    for (const other of obstacles) {
      xCandidates.push(other.x - 52, other.x + 52);
      yCandidates.push(other.y - 52, other.y + 52);
      const dx = Math.abs(point.x - other.x);
      const dy = Math.abs(point.y - other.y);
      if (dx < 52) {
        const offset = Math.sqrt(52 * 52 - dx * dx);
        yCandidates.push(other.y - offset, other.y + offset);
      }
      if (dy < 52) {
        const offset = Math.sqrt(52 * 52 - dy * dy);
        xCandidates.push(other.x - offset, other.x + offset);
      }
    }
    const candidates = [
      ...xCandidates.map((x) => ({ x, y: point.y })),
      ...yCandidates.map((y) => ({ x: point.x, y })),
    ];
    const isValid = ({ x, y }: { x: number; y: number }) => {
      if (
        x < MAP_EDGE_INSET ||
        x > width - MAP_EDGE_INSET ||
        y < MAP_EDGE_INSET ||
        y > height - MAP_EDGE_INSET
      )
        return false;
      if (
        controls &&
        x > controls.x - MAP_CONTROL_CLEARANCE &&
        x < controls.x + controls.width + MAP_CONTROL_CLEARANCE &&
        y > controls.y - MAP_CONTROL_CLEARANCE &&
        y < controls.y + controls.height + MAP_CONTROL_CLEARANCE
      )
        return false;
      return obstacles.every((other) => Math.hypot(x - other.x, y - other.y) >= 51.999);
    };
    let valid = candidates.filter(isValid);
    if (valid.length === 0) {
      valid = xCandidates.flatMap((x) => yCandidates.map((y) => ({ x, y }))).filter(isValid);
    }
    const onBoundary = ({ x, y }: { x: number; y: number }) =>
      x === MAP_EDGE_INSET ||
      x === width - MAP_EDGE_INSET ||
      y === MAP_EDGE_INSET ||
      y === height - MAP_EDGE_INSET ||
      (controls !== null &&
        ((x === controls.x - MAP_CONTROL_CLEARANCE &&
          y >= controls.y - MAP_CONTROL_CLEARANCE &&
          y <= controls.y + controls.height + MAP_CONTROL_CLEARANCE) ||
          ((y === controls.y - MAP_CONTROL_CLEARANCE ||
            y === controls.y + controls.height + MAP_CONTROL_CLEARANCE) &&
            x >= controls.x - MAP_CONTROL_CLEARANCE &&
            x <= controls.x + controls.width + MAP_CONTROL_CLEARANCE)));
    valid.sort(
      (a, b) =>
        Number(onBoundary(b)) - Number(onBoundary(a)) ||
        Math.hypot(a.x - point.x, a.y - point.y) +
          (prior ? (blocked ? 2 : 1) * Math.hypot(a.x - prior.x, a.y - prior.y) : 0) -
          Math.hypot(b.x - point.x, b.y - point.y) -
          (prior ? (blocked ? 2 : 1) * Math.hypot(b.x - prior.x, b.y - prior.y) : 0),
    );
    const chosen = valid[0];
    placed.push(chosen ? { ...point, ...chosen } : point);
  }
  return placed;
};
