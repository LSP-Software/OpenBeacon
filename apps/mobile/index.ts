import "./lib/installCrypto.ts";
import { tryCatch } from "@openbeacon/shared";
import { AppRegistry, Platform } from "react-native";
import OpenBeaconTracking from "./modules/openbeacon-tracking/index.ts";

const syncBackgroundTracking = async (reason: string | undefined) => {
  const tracking = await import("./lib/tracking.ts");
  await tracking.syncBackgroundTracking(
    reason === "sharing" || reason === "parked" ? reason : "upload",
  );
};

AppRegistry.registerHeadlessTask(
  "OpenBeaconTrackingUpload",
  () => (data: { reason?: string } | undefined) => syncBackgroundTracking(data?.reason),
);

if (Platform.OS === "ios") {
  OpenBeaconTracking.addListener("onSync", ({ reason }) => {
    void tryCatch(syncBackgroundTracking(reason));
  });
}

import "expo-router/entry";
