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
    let closest: {
      first: number;
      second: number;
      distance: number;
      a: TCluster;
      b: TCluster;
    } | null = null;
    for (const [first, a] of merged.entries()) {
      for (const [second, b] of merged.entries()) {
        if (second <= first) continue;
        const distance = distanceBetween(a, b);
        if (distance < mergeDistanceFor(a, b) && (!closest || distance < closest.distance)) {
          closest = { first, second, distance, a, b };
        }
      }
    }
    if (!closest) break;

    merged[closest.first] = merge(closest.a, closest.b);
    merged.splice(closest.second, 1);
  }

  return merged;
};
