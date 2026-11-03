import { tryCatch } from "@openbeacon/shared";
import { onlineManager } from "@tanstack/react-query";
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from "expo-network";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

const getOfflineState = (state: NetworkState) => {
  if (state.isConnected === false || state.isInternetReachable === false) return true;
  if (state.isConnected === true || state.isInternetReachable === true) return false;
  return null;
};

export const isDeviceOffline = async () => {
  const result = await tryCatch(getNetworkStateAsync());
  return !result.error && getOfflineState(result.data) === true;
};

export const useOfflineStatus = () => {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let revision = 0;
    let lastState: boolean | null = null;
    const update = (state: NetworkState) => {
      if (disposed) return;
      const nextOffline = getOfflineState(state);
      if (nextOffline === null) return;
      revision += 1;
      if (nextOffline === lastState) return;
      lastState = nextOffline;
      if (timer !== undefined) clearTimeout(timer);
      onlineManager.setOnline(!nextOffline);
      timer = setTimeout(() => setOffline(nextOffline), 5_000);
    };
    const refresh = () => {
      const currentRevision = revision;
      void getNetworkStateAsync()
        .then((state) => {
          if (revision === currentRevision) update(state);
        })
        .catch(() => {});
    };
    const network = addNetworkStateListener(update);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    refresh();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      network.remove();
      appState.remove();
    };
  }, []);

  return offline;
};
