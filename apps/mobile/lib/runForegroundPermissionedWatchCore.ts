import { tryCatch } from "@openbeacon/shared";

export const runForegroundPermissionedWatchCore = ({
  createSubscription,
  getAppState,
  getForegroundPermissions,
  onInactive,
  subscribeAppState,
}: {
  createSubscription: () => Promise<{ remove: () => void }>;
  getAppState: () => string;
  getForegroundPermissions: () => Promise<{ granted: boolean }>;
  onInactive?: () => void;
  subscribeAppState: (listener: (nextAppState: string) => void) => {
    remove: () => void;
  };
}) => {
  let cancelled = false;
  let starting = false;
  let subscription: { remove: () => void } | null = null;

  const stopSubscription = () => {
    subscription?.remove();
    subscription = null;
    onInactive?.();
  };

  const startWatching = async () => {
    if (cancelled || starting || subscription) {
      return;
    }

    starting = true;
    const permissionResult = await tryCatch(getForegroundPermissions());
    if (permissionResult.error || !permissionResult.data.granted || cancelled || subscription) {
      starting = false;
      return;
    }

    const watchResult = await tryCatch(createSubscription());
    starting = false;

    if (watchResult.error || cancelled || getAppState() !== "active") {
      watchResult.data?.remove();
      return;
    }

    subscription = watchResult.data;
  };

  const syncActive = () => {
    if (getAppState() !== "active") {
      stopSubscription();
      return;
    }

    if (!subscription && !starting) {
      void startWatching();
    }
  };

  syncActive();
  const appStateSubscription = subscribeAppState(syncActive);

  return () => {
    cancelled = true;
    appStateSubscription.remove();
    stopSubscription();
  };
};
