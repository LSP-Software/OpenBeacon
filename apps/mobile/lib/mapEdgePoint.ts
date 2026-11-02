export const MAP_EDGE_INSET = 30;
export const MAP_CONTROL_CLEARANCE = 28;

export const mapEdgePoint = ({
  controls,
  height,
  point,
  width,
}: {
  controls?: { x: number; y: number; width: number; height: number } | null;
  height: number;
  point: [number, number];
  width: number;
}): { angle: number; x: number; y: number } | null => {
  const inset = MAP_EDGE_INSET;
  if (width <= inset * 2 || height <= inset * 2) return null;
  const [x, y] = point;
  if (x >= inset && x <= width - inset && y >= inset && y <= height - inset) return null;

  let edgeX = Math.max(inset, Math.min(width - inset, x));
  let edgeY = Math.max(inset, Math.min(height - inset, y));
  if (controls) {
    const left = controls.x - MAP_CONTROL_CLEARANCE;
    const right = controls.x + controls.width + MAP_CONTROL_CLEARANCE;
    const top = controls.y - MAP_CONTROL_CLEARANCE;
    const bottom = controls.y + controls.height + MAP_CONTROL_CLEARANCE;
    if (edgeX > left && edgeX < right && edgeY > top && edgeY < bottom) {
      const rightEdge = width - inset;
      const bottomEdge = height - inset;
      if (left >= inset && left < rightEdge && right > rightEdge) {
        const startY = Math.max(inset, top);
        const endY = Math.min(bottomEdge, bottom);
        const topSpan = top < inset ? rightEdge - left : 0;
        const bottomSpan = bottom > bottomEdge ? rightEdge - left : 0;
        const originalLength = topSpan + endY - startY + bottomSpan;
        const originalProgress =
          edgeY === inset
            ? edgeX - left
            : edgeY === bottomEdge
              ? topSpan + endY - startY + rightEdge - edgeX
              : topSpan + edgeY - startY;
        const entryLength = topSpan ? 0 : rightEdge - left;
        const exitLength = bottomSpan ? 0 : rightEdge - left;
        const pathLength = entryLength + endY - startY + exitLength;
        const progress = originalLength > 0 ? (originalProgress / originalLength) * pathLength : 0;
        if (progress < entryLength) {
          edgeX = rightEdge - progress;
          edgeY = startY;
        } else if (progress < entryLength + endY - startY) {
          edgeX = left;
          edgeY = startY + progress - entryLength;
        } else {
          edgeX = left + progress - entryLength - (endY - startY);
          edgeY = endY;
        }
        return { angle: (Math.atan2(x - edgeX, edgeY - y) * 180) / Math.PI, x: edgeX, y: edgeY };
      }
      const candidates = [
        ...[inset, width - inset, left, right].flatMap((candidateX) => [
          { x: candidateX, y: inset },
          { x: candidateX, y: height - inset },
        ]),
        ...[inset, height - inset, top, bottom].flatMap((candidateY) => [
          { x: inset, y: candidateY },
          { x: width - inset, y: candidateY },
        ]),
      ].filter(
        ({ x, y }) =>
          x >= inset &&
          x <= width - inset &&
          y >= inset &&
          y <= height - inset &&
          !(x > left && x < right && y > top && y < bottom),
      );
      candidates.sort(
        (a, b) => Math.hypot(a.x - edgeX, a.y - edgeY) - Math.hypot(b.x - edgeX, b.y - edgeY),
      );
      const closest = candidates[0];
      if (!closest) return null;
      edgeX = closest.x;
      edgeY = closest.y;
    }
  }
  return {
    angle: (Math.atan2(x - edgeX, edgeY - y) * 180) / Math.PI,
    x: edgeX,
    y: edgeY,
  };
};
