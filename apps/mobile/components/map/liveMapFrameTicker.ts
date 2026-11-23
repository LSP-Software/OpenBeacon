const listeners = new Set<(nowMs: number) => void>();
let frame: number | null = null;

const tick = () => {
  frame = null;
  const nowMs = Date.now();
  for (const listener of [...listeners]) {
    if (listeners.has(listener)) listener(nowMs);
  }
  if (listeners.size > 0 && frame === null) frame = requestAnimationFrame(tick);
};

export const subscribeToLiveMapFrames = (listener: (nowMs: number) => void) => {
  listeners.add(listener);
  frame ??= requestAnimationFrame(tick);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || frame === null) return;
    cancelAnimationFrame(frame);
    frame = null;
  };
};
