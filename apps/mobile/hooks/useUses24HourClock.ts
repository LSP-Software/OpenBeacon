import { useCalendars } from "expo-localization";
import { localeUses24HourClock } from "../lib/timelineClock.ts";

export const useUses24HourClock = () =>
  useCalendars()[0]?.uses24hourClock ?? localeUses24HourClock();
