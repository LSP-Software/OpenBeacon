export const formatViewerDate = (date: Date) =>
  date.toLocaleDateString(undefined, { day: "numeric", month: "short" });

const formatTime = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export const formatViewerStretch = ({ from, to }: { from: Date | null; to: Date }) => {
  const end = `${formatViewerDate(to)}, ${formatTime(to)}`;
  if (!from) return `Until ${end}`;
  if (from.toDateString() === to.toDateString()) {
    return `${formatViewerDate(to)}, ${formatTime(from)} – ${formatTime(to)}`;
  }
  return `${formatViewerDate(from)}, ${formatTime(from)} – ${end}`;
};
