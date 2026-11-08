const MERGE_DISTANCE = 56;
const STAY_MERGED_DISTANCE = 64;

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
  const chips = points.map((point) => ({
    ...point,
    memberIds: [point.userId],
    directionX: Math.sin((point.angle * Math.PI) / 180),
    directionY: Math.cos((point.angle * Math.PI) / 180),
  }));

  while (chips.length > 1) {
    let closest: { first: number; second: number; distance: number } | null = null;
    for (let first = 0; first < chips.length; first += 1) {
      for (let second = first + 1; second < chips.length; second += 1) {
        const a = chips[first]!;
        const b = chips[second]!;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const wereTogether = a.memberIds.some((id) => {
          const chip = previousChipByMember.get(id);
          return (
            chip !== undefined &&
            b.memberIds.some((other) => previousChipByMember.get(other) === chip)
          );
        });
        if (
          distance < (wereTogether ? STAY_MERGED_DISTANCE : MERGE_DISTANCE) &&
          (!closest || distance < closest.distance)
        ) {
          closest = { first, second, distance };
        }
      }
    }
    if (!closest) break;

    const a = chips[closest.first]!;
    const b = chips[closest.second]!;
    const total = a.memberIds.length + b.memberIds.length;
    a.x = (a.x * a.memberIds.length + b.x * b.memberIds.length) / total;
    a.y = (a.y * a.memberIds.length + b.y * b.memberIds.length) / total;
    a.directionX += b.directionX;
    a.directionY += b.directionY;
    a.memberIds = [...a.memberIds, ...b.memberIds].sort();
    a.userId = a.memberIds[0] ?? a.userId;
    chips.splice(closest.second, 1);
  }

  return chips.map(({ directionX, directionY, ...chip }) => ({
    ...chip,
    angle:
      chip.memberIds.length > 1 ? (Math.atan2(directionX, directionY) * 180) / Math.PI : chip.angle,
  }));
};
