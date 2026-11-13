import { tryCatch } from "@openbeacon/shared";
import { Linking } from "react-native";

export const openPlayStore = async () => {
  const market = await tryCatch(Linking.openURL("market://details?id=net.openbeacon.app"));
  if (!market.error) return;
  await tryCatch(
    Linking.openURL("https://play.google.com/store/apps/details?id=net.openbeacon.app"),
  );
};
