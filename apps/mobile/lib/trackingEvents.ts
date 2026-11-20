const listeners = new Set<(options: { groupNotices: boolean }) => void>();
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

export const requestTrackingSync = ({ groupNotices = false }: { groupNotices?: boolean } = {}) => {
  for (const listener of listeners) {
    listener({ groupNotices });
  }
};

export const subscribeToTrackingSync = (listener: (options: { groupNotices: boolean }) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
