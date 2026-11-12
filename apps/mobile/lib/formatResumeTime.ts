export const formatResumeTime = (resumesAt: Date, now: Date) => {
  const time = resumesAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (resumesAt.toDateString() === now.toDateString()) return `Resumes at ${time}`;
  if (resumesAt.toDateString() === tomorrow.toDateString()) return `Resumes tomorrow at ${time}`;
  return `Resumes ${resumesAt.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
};
