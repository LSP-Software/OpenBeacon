import { mergeClosestPairs } from "./mergeClosestPairs.ts";

export const mergeMapEdgePoints = ({
  points,
  previous = [],
}: {
  points: readonly { userId: string; x: number; y: number; angle: number }[];
  previous?: readonly { memberIds: readonly string[] }[];
}) => {
  const previousChipByMember = new Map(
    previous.flatMap((chip, index) => chip.memberIds.map((id) => [id, index] as const)),
  );
  const chips = mergeClosestPairs({
    clusters: points.map((point) => ({
      ...point,
      memberIds: [point.userId],
      directionX: Math.sin((point.angle * Math.PI) / 180),
      directionY: Math.cos((point.angle * Math.PI) / 180),
    })),
    distanceBetween: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    mergeDistanceFor: (a, b) =>
      a.memberIds.some((id) => {
        const chip = previousChipByMember.get(id);
        return (
          chip !== undefined &&
          b.memberIds.some((other) => previousChipByMember.get(other) === chip)
        );
      })
        ? 64
        : 56,
    merge: (a, b) => {
      const total = a.memberIds.length + b.memberIds.length;
      const memberIds = [...a.memberIds, ...b.memberIds].sort();
      return {
        ...a,
        userId: memberIds[0] ?? a.userId,
        x: (a.x * a.memberIds.length + b.x * b.memberIds.length) / total,
        y: (a.y * a.memberIds.length + b.y * b.memberIds.length) / total,
        directionX: a.directionX + b.directionX,
        directionY: a.directionY + b.directionY,
        memberIds,
      };
    },
  });

  return chips.map(({ directionX, directionY, ...chip }) => ({
    ...chip,
    angle:
      chip.memberIds.length > 1 ? (Math.atan2(directionX, directionY) * 180) / Math.PI : chip.angle,
  }));
};
