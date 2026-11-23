import { useLocales } from "expo-localization";
import { useMMKVString } from "react-native-mmkv";
import { defaultUnits, parseUnitsPreference, type Units } from "../lib/units.ts";
import { storage } from "../lib/storage.ts";

export const useUnits = () => {
  const [stored, setStored] = useMMKVString("units.speed", storage);
  const [locale] = useLocales();
  const preference = parseUnitsPreference(stored);
  const regionUnit = defaultUnits(locale);
  return {
    preference,
    regionUnit,
    setPreference: (value: Units | "auto") => setStored(value === "auto" ? undefined : value),
    unit: preference === "auto" ? regionUnit : preference,
  };
};
