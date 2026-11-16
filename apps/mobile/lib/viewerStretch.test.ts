import { describe, expect, test } from "bun:test";
import { formatViewerDate, formatViewerStretch } from "./viewerStretch.ts";

const time = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

describe("formatViewerStretch", () => {
  const morning = new Date(2026, 10, 5, 9, 15);
  const evening = new Date(2026, 10, 5, 18, 40);
  const nextWeek = new Date(2026, 10, 12, 7, 5);

  test("shows the date once for a stretch within one day", () => {
    expect(formatViewerStretch({ from: morning, to: evening })).toBe(
      `${formatViewerDate(evening)}, ${time(morning)} – ${time(evening)}`,
    );
  });

  test("shows both dates and times across days", () => {
    expect(formatViewerStretch({ from: morning, to: nextWeek })).toBe(
      `${formatViewerDate(morning)}, ${time(morning)} – ${formatViewerDate(nextWeek)}, ${time(nextWeek)}`,
    );
  });

  test("shows only the end when the start is unknown", () => {
    expect(formatViewerStretch({ from: null, to: nextWeek })).toBe(
      `Until ${formatViewerDate(nextWeek)}, ${time(nextWeek)}`,
    );
  });
});
