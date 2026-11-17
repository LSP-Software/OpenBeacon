import { Platform } from "react-native";

export const loadTrackingModule = async () =>
  Platform.OS === "android" || Platform.OS === "ios"
    ? (await import("../modules/openbeacon-tracking/index.ts")).default
    : null;
