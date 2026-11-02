export const mapViewportPoint = ({
  bounds,
  coordinate,
  height,
  width,
}: {
  bounds: readonly [readonly number[], readonly number[]];
  coordinate: readonly [number, number];
  height: number;
  width: number;
}): [number, number] | null => {
  const [east, north] = bounds[0];
  const [west, south] = bounds[1];
  if (east === undefined || north === undefined || west === undefined || south === undefined)
    return null;
  const longitudeSpan = east >= west ? east - west : east + 360 - west;
  const mercatorY = (latitude: number) => {
    const radians = (Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + radians / 2));
  };
  const northY = mercatorY(north);
  const southY = mercatorY(south);
  if (
    !Number.isFinite(longitudeSpan) ||
    longitudeSpan <= 0 ||
    longitudeSpan > 360 ||
    !Number.isFinite(northY - southY) ||
    northY <= southY ||
    width <= 0 ||
    height <= 0
  )
    return null;
  const centerLongitude = west + longitudeSpan / 2;
  const longitudeOffset = ((((coordinate[0] - centerLongitude + 540) % 360) + 360) % 360) - 180;
  const x = width * (0.5 + longitudeOffset / longitudeSpan);
  const y = (height * (northY - mercatorY(coordinate[1]))) / (northY - southY);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
};
