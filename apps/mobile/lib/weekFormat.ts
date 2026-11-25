const DAY_MS = 86_400_000;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const calendarDay = (day: number) => {
  const date = new Date(day * DAY_MS);
  return {
    date: date.getUTCDate(),
    month: MONTH_NAMES[date.getUTCMonth()] ?? "",
  };
};

export const weekRangeLabel = (monday: number) => {
  const first = calendarDay(monday);
  const last = calendarDay(monday + 6);
  return first.month === last.month
    ? `Mon ${first.date} – Sun ${last.date} ${last.month}`
    : `Mon ${first.date} ${first.month} – Sun ${last.date} ${last.month}`;
};

export const weekDaysLabel = (from: number, to: number) =>
  from === to ? (DAY_NAMES[from] ?? "") : `${DAY_NAMES[from]}–${DAY_NAMES[to]}`;

export const weekDayDate = (monday: number, weekday: number) => {
  const { date, month } = calendarDay(monday + weekday);
  return `${DAY_NAMES[weekday]} ${date} ${month}`;
};

export const weekDayLetter = (weekday: number) => DAY_NAMES[weekday]?.[0] ?? "";

export const weekTimesLabel = (count: number) =>
  count === 0 ? "none" : count === 1 ? "once" : count === 2 ? "twice" : `${count} times`;

export const weekChange = ({
  higherIsBetter,
  now,
  previous,
}: {
  higherIsBetter: boolean;
  now: number;
  previous: number;
}) => {
  const difference = now - previous;
  return {
    amount: Math.abs(difference),
    direction:
      difference === 0 ? ("same" as const) : difference > 0 ? ("up" as const) : ("down" as const),
    good: difference === 0 || difference > 0 === higherIsBetter,
  };
};
