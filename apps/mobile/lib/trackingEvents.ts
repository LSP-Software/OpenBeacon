const listeners = new Set<() => void>();

export const requestTrackingSync = () => {
  for (const listener of listeners) {
    listener();
  }
};

export const subscribeToTrackingSync = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
