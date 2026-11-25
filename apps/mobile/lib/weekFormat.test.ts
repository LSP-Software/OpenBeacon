import { describe, expect, test } from "bun:test";
import {
  weekChange,
  weekDayDate,
  weekDaysLabel,
  weekRangeLabel,
  weekTimesLabel,
} from "./weekFormat.ts";

const DAY = 86_400_000;
const monday = (year: number, month: number, day: number) => Date.UTC(year, month, day) / DAY;

describe("week labels", () => {
  test("names the week by its Monday and Sunday", () => {
    expect(weekRangeLabel(monday(2026, 10, 23))).toBe("Mon 23 – Sun 29 Nov");
    expect(weekRangeLabel(monday(2026, 10, 30))).toBe("Mon 30 Nov – Sun 6 Dec");
    expect(weekRangeLabel(monday(2026, 11, 28))).toBe("Mon 28 Dec – Sun 3 Jan");
  });

  test("names days in the week", () => {
    expect(weekDaysLabel(0, 1)).toBe("Mon–Tue");
    expect(weekDaysLabel(0, 0)).toBe("Mon");
    expect(weekDaysLabel(5, 6)).toBe("Sat–Sun");
    expect(weekDayDate(monday(2026, 10, 16), 5)).toBe("Sat 21 Nov");
  });

  test("words event counts", () => {
    expect([0, 1, 2, 5].map(weekTimesLabel)).toEqual(["none", "once", "twice", "5 times"]);
  });
});

describe("changes against last week", () => {
  test("says which way and by how much, and whether that is better", () => {
    expect(weekChange({ now: 86, previous: 82, higherIsBetter: true })).toEqual({
      direction: "up",
      good: true,
      amount: 4,
    });
    expect(weekChange({ now: 3, previous: 5, higherIsBetter: false })).toEqual({
      direction: "down",
      good: true,
      amount: 2,
    });
    expect(weekChange({ now: 1, previous: 0, higherIsBetter: false })).toEqual({
      direction: "up",
      good: false,
      amount: 1,
    });
    expect(weekChange({ now: 2, previous: 2, higherIsBetter: false })).toEqual({
      direction: "same",
      good: true,
      amount: 0,
    });
  });
});
