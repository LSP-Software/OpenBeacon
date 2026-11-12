import { describe, expect, test } from "bun:test";
import { formatResumeTime } from "./formatResumeTime.ts";

describe("formatResumeTime", () => {
  const now = new Date(2026, 10, 12, 22, 30);
  const time = (date: Date) =>
    date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  test("leaves out the day when sharing resumes later today", () => {
    const resumesAt = new Date(2026, 10, 12, 23, 45);

    expect(formatResumeTime(resumesAt, now)).toBe(`Resumes at ${time(resumesAt)}`);
  });

  test("says tomorrow when sharing resumes the next day", () => {
    const resumesAt = new Date(2026, 10, 13, 5, 58);

    expect(formatResumeTime(resumesAt, now)).toBe(`Resumes tomorrow at ${time(resumesAt)}`);
  });

  test("handles tomorrow across a month end", () => {
    const resumesAt = new Date(2026, 11, 1, 8, 0);

    expect(formatResumeTime(resumesAt, new Date(2026, 10, 30, 20, 0))).toBe(
      `Resumes tomorrow at ${time(resumesAt)}`,
    );
  });

  test("uses the weekday when sharing resumes later than tomorrow", () => {
    const resumesAt = new Date(2026, 10, 14, 9, 15);

    expect(formatResumeTime(resumesAt, now)).toBe(
      `Resumes ${resumesAt.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`,
    );
  });
});
