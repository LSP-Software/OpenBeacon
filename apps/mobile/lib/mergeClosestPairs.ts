export const mergeClosestPairs = <TCluster>({
  clusters,
  distanceBetween,
  merge,
  mergeDistanceFor,
}: {
  clusters: readonly TCluster[];
  distanceBetween: (first: TCluster, second: TCluster) => number;
  merge: (first: TCluster, second: TCluster) => TCluster;
  mergeDistanceFor: (first: TCluster, second: TCluster) => number;
}) => {
  const merged = [...clusters];

  while (merged.length > 1) {
    let closest: { first: number; second: number; distance: number } | null = null;
    for (let first = 0; first < merged.length; first += 1) {
      for (let second = first + 1; second < merged.length; second += 1) {
        const a = merged[first]!;
        const b = merged[second]!;
        const distance = distanceBetween(a, b);
        if (distance < mergeDistanceFor(a, b) && (!closest || distance < closest.distance)) {
          closest = { first, second, distance };
        }
      }
    }
    if (!closest) break;

    merged[closest.first] = merge(merged[closest.first]!, merged[closest.second]!);
    merged.splice(closest.second, 1);
  }

  return merged;
};
