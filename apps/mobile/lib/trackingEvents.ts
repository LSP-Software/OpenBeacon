const listeners = new Set<() => void>();
const epochListeners = new Set<(groupId: string) => void>();

export const notifyGroupEpochChange = (groupId: string) => {
  for (const listener of epochListeners) listener(groupId);
};

export const subscribeToGroupEpochChanges = (listener: (groupId: string) => void) => {
  epochListeners.add(listener);
  return () => {
    epochListeners.delete(listener);
  };
};

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
