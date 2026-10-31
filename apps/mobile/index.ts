import "./lib/installCrypto.ts";
import { AppRegistry } from "react-native";

AppRegistry.registerHeadlessTask("OpenBeaconTrackingUpload", () => async () => {
  const { flushPendingTrackingPoints } = await import("./lib/tracking.ts");
  await flushPendingTrackingPoints();
});

import "expo-router/entry";
