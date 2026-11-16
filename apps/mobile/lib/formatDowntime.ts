export const formatDowntime = (startsAt: Date, endsAt: Date, now: Date) => {
  const time = (date: Date) =>
    date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const day = (date: Date) => {
    if (date.toDateString() === now.toDateString()) return "today";
    if (date.toDateString() === tomorrow.toDateString()) return "tomorrow";
    return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  };
  if (startsAt.toDateString() === endsAt.toDateString()) {
    return `Down ${day(startsAt)} from ${time(startsAt)} to ${time(endsAt)}`;
  }
  return `Down from ${day(startsAt)} at ${time(startsAt)} to ${day(endsAt)} at ${time(endsAt)}`;
};
