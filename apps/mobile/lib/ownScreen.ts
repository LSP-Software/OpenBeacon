const open = new Set<symbol>();
const closedListeners = new Set<() => void>();

export const isOwnScreenOpen = () => open.size > 0;

export const resetOwnScreens = () => {
  open.clear();
};

export const onOwnScreenClosed = (listener: () => void) => {
  closedListeners.add(listener);
  return () => closedListeners.delete(listener);
};

export const withOwnScreen = async <T>(show: () => Promise<T>) => {
  const screen = Symbol();
  open.add(screen);
  try {
    return await show();
  } finally {
    open.delete(screen);
    for (const listener of closedListeners) listener();
  }
};
