import { useLocales } from "expo-localization";
import { useMMKVString } from "react-native-mmkv";
import {
  defaultUnits,
  parseDistancePreference,
  parseSpeedPreference,
  type DistanceUnit,
  type SpeedUnit,
} from "../lib/units.ts";
import { storage } from "../lib/storage.ts";

export const useUnits = () => {
  const [storedSpeed, setStoredSpeed] = useMMKVString("units.speed", storage);
  const [storedDistance, setStoredDistance] = useMMKVString("units.distance", storage);
  const [locale] = useLocales();
  const region = defaultUnits(locale);
  const speedPreference = parseSpeedPreference(storedSpeed);
  const distancePreference = parseDistancePreference(storedDistance, storedSpeed);
  return {
    region,
    speedPreference,
    distancePreference,
    setSpeedPreference: (value: SpeedUnit | "auto") => {
      if (storedDistance === undefined) setStoredDistance(distancePreference);
      setStoredSpeed(value === "auto" ? undefined : value);
    },
    setDistancePreference: (value: DistanceUnit | "auto") => setStoredDistance(value),
    speed: speedPreference === "auto" ? region.speed : speedPreference,
    distance: distancePreference === "auto" ? region.distance : distancePreference,
  };
};
