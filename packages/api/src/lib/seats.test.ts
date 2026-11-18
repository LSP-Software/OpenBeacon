import { expect, test } from "bun:test";
import { seatsEnforced } from "./seats.ts";

test("only hosted servers enforce seats", () => {
  expect(seatsEnforced({ selfHosted: true })).toBe(false);
  expect(seatsEnforced({ selfHosted: false })).toBe(true);
});
