import { getLocales } from "expo-localization";
import { storage } from "./storage.ts";
import { defaultUnits, parseDistancePreference, parseSpeedPreference } from "./units.ts";

export const storedUnits = () => {
  const [locale] = getLocales();
  const region = defaultUnits({
    measurementSystem: locale?.measurementSystem ?? null,
    regionCode: locale?.regionCode ?? null,
  });
  const storedSpeed = storage.getString("units.speed");
  const speed = parseSpeedPreference(storedSpeed);
  const distance = parseDistancePreference(storage.getString("units.distance"), storedSpeed);
  return {
    speed: speed === "auto" ? region.speed : speed,
    distance: distance === "auto" ? region.distance : distance,
  };
};
