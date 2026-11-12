import "./lib/installCrypto.ts";
import { AppRegistry } from "react-native";

AppRegistry.registerHeadlessTask(
  "OpenBeaconTrackingUpload",
  () => async (data: { reason?: string } | undefined) => {
    const { syncBackgroundTracking } = await import("./lib/tracking.ts");
    await syncBackgroundTracking(
      data?.reason === "sharing" || data?.reason === "parked" ? data.reason : "upload",
    );
  },
);

import "expo-router/entry";
