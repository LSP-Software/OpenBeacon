import "./lib/installCrypto.ts";
import { AppRegistry } from "react-native";

AppRegistry.registerHeadlessTask("OpenBeaconTrackingUpload", () => async () => {
  const { syncBackgroundTracking } = await import("./lib/tracking.ts");
  await syncBackgroundTracking();
});

import "expo-router/entry";
