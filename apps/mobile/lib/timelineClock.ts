export const formatTimelineClock = (time: number, uses24HourClock: boolean) =>
  new Date(time).toLocaleTimeString(undefined, {
    hour: uses24HourClock ? "2-digit" : "numeric",
    hourCycle: uses24HourClock ? "h23" : "h12",
    minute: "2-digit",
  });

export const formatTimelineDayEnd = (dayEnd: number, uses24HourClock: boolean) =>
  uses24HourClock ? "24:00" : formatTimelineClock(dayEnd, false);

export const formatTimelineHourTick = (hour: number, uses24HourClock: boolean) =>
  uses24HourClock
    ? String(hour).padStart(2, "0")
    : new Date(2026, 0, 1, hour % 24).toLocaleTimeString(undefined, {
        hour: "numeric",
        hourCycle: "h12",
      });

export const localeUses24HourClock = () => {
  const { hourCycle } = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions();
  return hourCycle === "h23" || hourCycle === "h24";
};
