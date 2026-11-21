import { useLocales } from "expo-localization";
import { useMMKVString } from "react-native-mmkv";
import { defaultSpeedUnit, type SpeedUnit } from "../lib/speed.ts";
import { storage } from "../lib/storage.ts";

export const useSpeedUnit = () => {
  const [stored, setStored] = useMMKVString("units.speed", storage);
  const [locale] = useLocales();
  const preference: SpeedUnit | "auto" = stored === "mph" || stored === "kmh" ? stored : "auto";
  const regionUnit = defaultSpeedUnit(locale);
  return {
    preference,
    regionUnit,
    setPreference: (value: SpeedUnit | "auto") => setStored(value === "auto" ? undefined : value),
    unit: preference === "auto" ? regionUnit : preference,
  };
};
