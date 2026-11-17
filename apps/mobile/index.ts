import "./lib/installCrypto.ts";
import { tryCatch } from "@openbeacon/shared";
import { AppRegistry, Platform } from "react-native";
import type { UploadReason } from "./lib/tracking.ts";
import OpenBeaconTracking from "./modules/openbeacon-tracking/index.ts";

const syncBackgroundTracking = async (reason: string | undefined) => {
  const uploadReason: UploadReason =
    reason === "sharing" || reason === "parked" || reason === "push" ? reason : "upload";
  const synced = await tryCatch(
    import("./lib/tracking.ts").then(({ syncBackgroundTracking }) =>
      syncBackgroundTracking(uploadReason),
    ),
  );
  if (synced.error) console.warn("Background tracking sync failed", synced.error);
};

AppRegistry.registerHeadlessTask(
  "OpenBeaconTrackingUpload",
  () => (data: { reason?: string } | undefined) => syncBackgroundTracking(data?.reason),
);

if (Platform.OS === "ios") {
  OpenBeaconTracking.addListener("onSync", ({ reason }) => {
    void syncBackgroundTracking(reason);
  });
}

import "expo-router/entry";
